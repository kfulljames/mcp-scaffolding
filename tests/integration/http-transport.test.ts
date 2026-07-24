import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { loadEnvironment } from "../../src/config/environment.js";
import { ToolRegistry } from "../../src/server/tool-registry.js";
import { createHttpApp } from "../../src/server/transports.js";
import type { ServerDependencies } from "../../src/server/create-server.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import {
  MockVendorClient,
  type MockVendorCapableClient,
} from "../../examples/vendor/mock-vendor-client.js";
import { SingleTenantResolver } from "../../src/auth/tenant-resolver.js";
import {
  CachingCredentialProvider,
  EnvCredentialProvider,
} from "../../src/auth/credential-provider.js";
import { RoleBasedAuthorizationPolicy } from "../../src/auth/authorization-policy.js";
import { ApiKeyAuthenticator } from "../../src/auth/http-authenticator.js";
import { StructuredAuditLogger } from "../../src/observability/audit-log.js";
import { InMemoryMetrics } from "../../src/observability/metrics.js";
import { createLogger } from "../../src/observability/logger.js";
import { InMemoryOperationTokenStore } from "../../src/safety/operation-token.js";
import { InMemoryApprovalService } from "../../src/safety/approval-service.js";
import { TokenBucketRateLimiter } from "../../src/safety/rate-limiter.js";

/**
 * Exercises the real HTTP transport over an actual listening socket — this is the same
 * shape of check as the manual `curl` smoke test this scaffold was validated against, just
 * automated. Complements tests/integration/mcp-protocol.test.ts, which exercises the MCP
 * protocol layer in-process without a socket.
 */
function testDeps(): ServerDependencies<MockVendorCapableClient> {
  const config = loadEnvironment({
    TRANSPORT: "http",
    SERVER_NAME: "http-test-server",
    SERVER_VERSION: "0.0.0-test",
    READ_ONLY: "true",
    MCP_PRESETS: "service-desk",
    AUTH_MODE: "api-key",
    API_KEYS: "test-key:local-dev:local:admin",
    VENDOR_BASE_URL: "https://vendor.test",
  });
  const registry = new ToolRegistry().registerAll([searchOpenHighPriorityTickets]);
  return {
    config,
    registry,
    tenantResolver: new SingleTenantResolver({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    }),
    credentialProvider: new CachingCredentialProvider(
      new EnvCredentialProvider({ MOCKVENDOR_API_KEY: "test-key" }),
    ),
    authorizationPolicy: new RoleBasedAuthorizationPolicy({ admin: ["tickets.read"] }),
    vendorName: "mockvendor",
    createVendorClient: (credentials, tenant) =>
      new MockVendorClient(credentials, tenant),
    logger: createLogger({ level: "silent", format: "json", name: "test" }),
    auditLogger: new StructuredAuditLogger(
      createLogger({ level: "silent", format: "json", name: "test-audit" }),
    ),
    metrics: new InMemoryMetrics(),
    tokenStore: new InMemoryOperationTokenStore(),
    approvalService: new InMemoryApprovalService(),
  };
}

describe("createHttpApp", () => {
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    const deps = testDeps();
    const authenticator = new ApiKeyAuthenticator(deps.config.API_KEYS!);
    // Deliberately near-zero refill: with real HTTP round trips in this test taking single-digit
    // milliseconds, any non-trivial refill rate makes "the bucket is still empty" non-deterministic.
    const app = createHttpApp(
      deps,
      authenticator,
      deps.logger,
      new TokenBucketRateLimiter(2, 0.001),
    );
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /health/live responds ok without authentication", async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /health/ready reports config summary without authentication", async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "ok",
      readOnly: true,
      presets: ["service-desk"],
    });
  });

  it("GET /health/vendor is a documented stub, not a silent 200", async () => {
    const res = await fetch(`${baseUrl}/health/vendor`);
    expect(res.status).toBe(501);
  });

  it("POST /mcp without credentials is rejected with 401, never reaches a tool", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  it("enforces the per-principal rate limit after the configured capacity is exhausted", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-key",
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    });

    const first = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body });
    const second = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body });
    const third = await fetch(`${baseUrl}/mcp`, { method: "POST", headers, body });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBeTruthy();
  });
});
