import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthenticatedPrincipal } from "../auth/authenticated-principal.js";
import type { TenantResolver } from "../auth/tenant-resolver.js";
import type {
  CredentialProvider,
  VendorCredentials,
} from "../auth/credential-provider.js";
import type { AuthorizationPolicy } from "../auth/authorization-policy.js";
import type { VendorClient } from "../vendor/client.js";
import type { ResolvedTenant } from "../auth/tenant-resolver.js";
import type { Logger } from "../observability/logger.js";
import type { AuditLogger, AuditOutcome } from "../observability/audit-log.js";
import type { Metrics } from "../observability/metrics.js";
import { generateId, runWithContext } from "../observability/correlation.js";
import { sanitizeForLogDeep } from "../safety/input-sanitizer.js";
import { ToolRegistry } from "./tool-registry.js";
import type { Environment } from "../config/schema.js";
import { toControlledError } from "../vendor/errors.js";
import { runDryRun } from "../safety/dry-run.js";
import {
  verifyAndExecuteWrite,
  WriteVerificationError,
} from "../safety/write-executor.js";
import type { OperationTokenStore } from "../safety/operation-token.js";
import { OperationTokenError } from "../safety/operation-token.js";
import { ApprovalError, type ApprovalService } from "../safety/approval-service.js";
import type { AnyToolDefinition } from "../tools/tool-definition.js";
import type { ToolContext } from "../tools/tool-context.js";

export interface ServerDependencies<TVendor extends VendorClient> {
  config: Environment;
  registry: ToolRegistry;
  tenantResolver: TenantResolver;
  credentialProvider: CredentialProvider;
  authorizationPolicy: AuthorizationPolicy;
  /** The vendor name used for credential lookup — e.g. "connectwise". */
  vendorName: string;
  createVendorClient: (credentials: VendorCredentials, tenant: ResolvedTenant) => TVendor;
  logger: Logger;
  auditLogger: AuditLogger;
  metrics: Metrics;
  tokenStore: OperationTokenStore;
  approvalService: ApprovalService;
}

interface CallOutcome {
  // The MCP SDK's CallToolResult carries a passthrough index signature (it allows
  // protocol extension fields) — matching that here is required for structural
  // assignability to the SDK's expected handler return type, not just documentation.
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function textResult(payload: unknown, isError = false): CallOutcome {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], isError };
}

function errorResult(code: string, message: string): CallOutcome {
  return textResult({ error: { code, message } }, true);
}

/**
 * Builds one MCP request's execution context: resolves tenant, authorizes,
 * resolves vendor credentials, constructs the vendor client. Every field a
 * tool's execute()/preview() can see comes from here — a tool never
 * constructs a ToolContext itself (see src/tools/tool-context.ts).
 */
async function buildToolContext<TVendor extends VendorClient>(
  deps: ServerDependencies<TVendor>,
  principal: AuthenticatedPrincipal,
  tool: AnyToolDefinition,
  requestedTenant: string | undefined,
  requestId: string,
  correlationId: string,
  signal: AbortSignal,
): Promise<ToolContext<TVendor>> {
  const tenant = await deps.tenantResolver.resolve(principal, requestedTenant);
  const authorization = await deps.authorizationPolicy.authorize({
    principal,
    tenant,
    permission: tool.access.permissions,
    risk: tool.access.risk,
  });
  const credentials = await deps.credentialProvider.getCredentials(
    tenant,
    deps.vendorName,
  );
  const vendor = deps.createVendorClient(credentials, tenant);

  return {
    requestId,
    correlationId,
    principal,
    tenant,
    vendor,
    authorization,
    audit: deps.auditLogger,
    signal,
  };
}

function withRequestTimeout(
  requestTimeoutMs: number,
  externalSignal: AbortSignal | undefined,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const onExternalAbort = (): void => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/**
 * Registers the read-path or plain (non-approval-gated) execute handler
 * for a tool. Handles auth, timeout, structured audit logging, output
 * minimization, and controlled error mapping uniformly — a tool author
 * never writes this plumbing themselves.
 */
function registerExecuteTool<TVendor extends VendorClient>(
  server: McpServer,
  tool: AnyToolDefinition,
  principal: AuthenticatedPrincipal,
  deps: ServerDependencies<TVendor>,
): void {
  const schemaShape = (tool.inputSchema as z.AnyZodObject).shape as z.ZodRawShape;
  const outputShape = (tool.outputSchema as z.AnyZodObject).shape as z.ZodRawShape;

  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: schemaShape,
      outputSchema: outputShape,
      annotations: {
        title: tool.name,
        readOnlyHint: tool.access.mode === "read",
        destructiveHint: tool.access.risk === "high",
        idempotentHint: tool.idempotency.strategy !== "none",
        // This server always talks to a live external vendor API.
        openWorldHint: true,
      },
    },
    async (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => {
      const requestId = generateId();
      const correlationId = generateId();
      const startedAt = Date.now();
      const { signal, cleanup } = withRequestTimeout(
        deps.config.REQUEST_TIMEOUT_MS,
        extra.signal,
      );

      return runWithContext({ requestId, correlationId }, async () => {
        let outcome: AuditOutcome = "executed";
        let tenantId = "unknown";
        try {
          const parsedInput = tool.inputSchema.parse(args) as Record<string, unknown> & {
            tenantId?: string;
          };

          const context = await buildToolContext(
            deps,
            principal,
            tool,
            parsedInput.tenantId,
            requestId,
            correlationId,
            signal,
          );
          tenantId = context.tenant.tenantId;

          if (!context.authorization.allowed) {
            outcome = "denied";
            return errorResult("FORBIDDEN", context.authorization.reason);
          }

          const rawOutput =
            tool.access.mode === "write"
              ? await verifyAndExecuteWrite(
                  tool,
                  parsedInput,
                  context,
                  deps.tokenStore,
                  deps.approvalService,
                )
              : await tool.execute(parsedInput, context);

          const validatedOutput = tool.outputSchema.parse(rawOutput) as Record<
            string,
            unknown
          >;
          return { ...textResult(validatedOutput), structuredContent: validatedOutput };
        } catch (error) {
          outcome = "error";
          if (error instanceof WriteVerificationError) {
            return errorResult("WRITE_VERIFICATION_FAILED", error.message);
          }
          if (error instanceof OperationTokenError || error instanceof ApprovalError) {
            return errorResult("APPROVAL_REQUIRED", error.message);
          }
          if (error instanceof z.ZodError) {
            return errorResult(
              "INVALID_INPUT",
              `Input failed schema validation: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
            );
          }
          const controlled = toControlledError(error);
          deps.logger.error(
            {
              err: sanitizeForLogDeep(String(error)),
              code: controlled.code,
              tool: tool.name,
            },
            "tool execution failed",
          );
          return errorResult(controlled.code, controlled.message);
        } finally {
          cleanup();
          deps.metrics.recordHistogram("tool.duration_ms", Date.now() - startedAt, {
            tool: tool.name,
          });
          deps.metrics.incrementCounter("tool.calls", { tool: tool.name, outcome });
          deps.auditLogger.record({
            timestamp: new Date().toISOString(),
            requestId,
            correlationId,
            principalId: principal.subjectId,
            organizationId: principal.organizationId,
            tenantId,
            tool: tool.name,
            accessMode: tool.access.mode,
            risk: tool.access.risk,
            outcome,
            durationMs: Date.now() - startedAt,
          });
        }
      });
    },
  );
}

const PREVIEW_OUTPUT_SCHEMA = z.object({
  action: z.string(),
  target: z.string(),
  proposedChanges: z.record(z.unknown()),
  digest: z.string(),
  operationToken: z.string().optional(),
  operationTokenExpiresAt: z.number().optional(),
  approvalToken: z.string().optional(),
  approvalExpiresAt: z.number().optional(),
});

function registerPreviewTool<TVendor extends VendorClient>(
  server: McpServer,
  tool: AnyToolDefinition,
  principal: AuthenticatedPrincipal,
  deps: ServerDependencies<TVendor>,
): void {
  const schemaShape = (tool.inputSchema as z.AnyZodObject).shape as z.ZodRawShape;

  server.registerTool(
    `preview_${tool.name}`,
    {
      description:
        `Dry-run preview for ${tool.name}. Read-only: shows the proposed change and, if ` +
        "required, returns the tokens needed to actually execute it. Does not modify vendor state.",
      inputSchema: schemaShape,
      outputSchema: PREVIEW_OUTPUT_SCHEMA.shape,
      annotations: {
        title: `preview_${tool.name}`,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args: Record<string, unknown>, extra: { signal?: AbortSignal }) => {
      const requestId = generateId();
      const correlationId = generateId();
      const { signal, cleanup } = withRequestTimeout(
        deps.config.REQUEST_TIMEOUT_MS,
        extra.signal,
      );
      try {
        return await runWithContext({ requestId, correlationId }, async () => {
          const parsedInput = tool.inputSchema.parse(args) as Record<string, unknown> & {
            tenantId?: string;
          };
          const context = await buildToolContext(
            deps,
            principal,
            tool,
            parsedInput.tenantId,
            requestId,
            correlationId,
            signal,
          );
          if (!context.authorization.allowed) {
            return errorResult("FORBIDDEN", context.authorization.reason);
          }
          const result = await runDryRun(
            tool,
            parsedInput,
            context,
            deps.tokenStore,
            deps.approvalService,
          );
          deps.auditLogger.record({
            timestamp: new Date().toISOString(),
            requestId,
            correlationId,
            principalId: principal.subjectId,
            organizationId: principal.organizationId,
            tenantId: context.tenant.tenantId,
            tool: tool.name,
            accessMode: "write",
            risk: tool.access.risk,
            outcome: "dry_run",
          });
          const payload = {
            ...result.preview,
            digest: result.digest,
            operationToken: result.operationToken,
            operationTokenExpiresAt: result.operationTokenExpiresAt,
            approvalToken: result.approvalToken,
            approvalExpiresAt: result.approvalExpiresAt,
          };
          return { ...textResult(payload), structuredContent: payload };
        });
      } catch (error) {
        const controlled = toControlledError(error);
        return errorResult(controlled.code, controlled.message);
      } finally {
        cleanup();
      }
    },
  );
}

const APPROVE_INPUT_SCHEMA = z.object({ approvalToken: z.string() });
const APPROVE_OUTPUT_SCHEMA = z.object({ approved: z.boolean(), digest: z.string() });

/**
 * One shared `approve_operation` tool, registered whenever any enabled
 * write tool requires human approval. The calling principal is the
 * approver — separation of duties (approver != requester) is enforced by
 * ApprovalService.approve.
 */
function registerApprovalTool<TVendor extends VendorClient>(
  server: McpServer,
  principal: AuthenticatedPrincipal,
  deps: ServerDependencies<TVendor>,
): void {
  server.registerTool(
    "approve_operation",
    {
      description:
        "Approves a pending high-risk operation by its approvalToken (returned by a preview_* tool). " +
        "The approving principal must differ from the principal that requested the preview.",
      inputSchema: APPROVE_INPUT_SCHEMA.shape,
      outputSchema: APPROVE_OUTPUT_SCHEMA.shape,
      annotations: {
        title: "approve_operation",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args: { approvalToken: string }) => {
      try {
        const record = deps.approvalService.approve(
          args.approvalToken,
          principal.subjectId,
        );
        const payload = { approved: true, digest: record.digest };
        return { ...textResult(payload), structuredContent: payload };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Approval failed.";
        return errorResult("APPROVAL_FAILED", message);
      }
    },
  );
}

/**
 * Composition root: builds one McpServer instance, registered with exactly
 * the tools this principal's server surface should expose — preset
 * filtering and READ_ONLY filtering applied, write tools paired with their
 * `preview_*` companion, `approve_operation` added if any enabled tool
 * needs it. Called once per stdio process, or once per HTTP request in the
 * stateless transport pattern (see src/server/transports.ts) — a fresh
 * instance per HTTP request is what makes "no state leaks between tenants"
 * true by construction rather than by discipline.
 */
export function buildMcpServer<TVendor extends VendorClient>(
  principal: AuthenticatedPrincipal,
  deps: ServerDependencies<TVendor>,
): McpServer {
  const server = new McpServer({
    name: deps.config.SERVER_NAME,
    version: deps.config.SERVER_VERSION,
  });

  const presetTools = deps.registry.resolvePresets(deps.config.MCP_PRESETS);
  const activeTools = deps.registry.filterReadOnly(presetTools, deps.config.READ_ONLY);

  let anyHumanApprovalRequired = false;
  for (const tool of activeTools) {
    registerExecuteTool(server, tool, principal, deps);
    if (tool.access.mode === "write") {
      registerPreviewTool(server, tool, principal, deps);
      if (tool.approvalPolicy.humanApprovalRequired) anyHumanApprovalRequired = true;
    }
  }
  if (anyHumanApprovalRequired) {
    registerApprovalTool(server, principal, deps);
  }

  return server;
}
