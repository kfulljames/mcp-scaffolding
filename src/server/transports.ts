import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import type { AuthenticatedPrincipal } from "../auth/authenticated-principal.js";
import type { HttpAuthenticator } from "../auth/http-authenticator.js";
import { AuthenticationError } from "../auth/http-authenticator.js";
import type { VendorClient } from "../vendor/client.js";
import { buildMcpServer, type ServerDependencies } from "./create-server.js";
import type { Logger } from "../observability/logger.js";
import { TokenBucketRateLimiter, type RateLimiter } from "../safety/rate-limiter.js";

/**
 * TRANSPORT is read explicitly from config (src/config/schema.ts), never
 * inferred from whether PORT happens to be set — an implicit mode switch
 * on an incidental env var is a real footgun observed in the field. See
 * SPEC.md §11 and MCP-SCAFFOLD-REFERENCE.md.
 */
export async function startStdioServer<TVendor extends VendorClient>(
  principal: AuthenticatedPrincipal,
  deps: ServerDependencies<TVendor>,
): Promise<void> {
  const server = buildMcpServer(principal, deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function normalizeHeaders(req: Request): Record<string, string | string[] | undefined> {
  return req.headers;
}

/**
 * Stateless streamable-HTTP mode: a fresh McpServer + transport per HTTP
 * request rather than a long-lived session. This is deliberate, not just
 * "the simple option" — it makes cross-tenant state leakage structurally
 * impossible (there is no shared server instance for two concurrent
 * requests to leak through), which is exactly what
 * tests/tenant-isolation/ asserts. The cost is losing MCP session-level
 * features (e.g. server-initiated notifications mid-session); accept that
 * cost unless a specific deployment proves it needs sessions, and if it
 * does, re-introduce sessions deliberately rather than by default.
 */
export function createHttpApp<TVendor extends VendorClient>(
  deps: ServerDependencies<TVendor>,
  authenticator: HttpAuthenticator,
  logger: Logger,
  rateLimiter: RateLimiter = new TokenBucketRateLimiter(
    deps.config.RATE_LIMIT_PER_MINUTE,
    deps.config.RATE_LIMIT_PER_MINUTE / 60,
  ),
): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Liveness: process is up. Never depends on a vendor call — a transient
  // vendor outage must never cause an orchestrator to kill a healthy container.
  app.get("/health/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  // Readiness: config loaded and dependencies constructible. Still no vendor call.
  app.get("/health/ready", (_req, res) => {
    res.status(200).json({
      status: "ok",
      presets: deps.config.MCP_PRESETS,
      readOnly: deps.config.READ_ONLY,
    });
  });

  // Vendor connectivity diagnostic — sanitized, best-effort, never leaks credential detail.
  app.get("/health/vendor", (_req, res) => {
    res.status(501).json({
      status: "not_configured",
      detail:
        "Wire this to a per-tenant-agnostic health probe if your vendor supports one, or remove this " +
        "route if vendor health can only be checked in a tenant context. See docs/DEPLOYMENT.md.",
    });
  });

  app.all("/mcp", (req: Request, res: Response) => {
    void (async () => {
      let principal: AuthenticatedPrincipal;
      try {
        principal = await authenticator.authenticate(normalizeHeaders(req));
      } catch (error) {
        const message =
          error instanceof AuthenticationError ? error.message : "Authentication failed.";
        res.status(401).json({ error: { code: "UNAUTHENTICATED", message } });
        return;
      }

      // Rate-limited per authenticated principal, AFTER auth so an unauthenticated
      // flood is rejected by the 401 path above rather than consuming rate-limit
      // budget shared with legitimate callers.
      const rateLimit = rateLimiter.checkAndConsume(principal.subjectId);
      if (!rateLimit.allowed) {
        logger.warn({ subjectId: principal.subjectId }, "rate limit exceeded");
        if (rateLimit.retryAfterSeconds !== undefined) {
          res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
        }
        res
          .status(429)
          .json({ error: { code: "RATE_LIMITED", message: "Too many requests." } });
        return;
      }

      const server = buildMcpServer(principal, deps);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on("close", () => {
        transport
          .close()
          .catch((err: unknown) =>
            logger.warn({ err: String(err) }, "error closing transport"),
          );
        server
          .close()
          .catch((err: unknown) =>
            logger.warn({ err: String(err) }, "error closing server"),
          );
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body as unknown);
      } catch (error) {
        logger.error({ err: String(error) }, "error handling MCP request");
        if (!res.headersSent) {
          res.status(500).json({
            error: { code: "INTERNAL_ERROR", message: "An internal error occurred." },
          });
        }
      }
    })();
  });

  return app;
}
