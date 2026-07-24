import type { ToolDefinition, ToolPreview } from "../tools/tool-definition.js";
import type { ToolContext } from "../tools/tool-context.js";
import type { VendorClient } from "../vendor/client.js";
import {
  computeOperationDigest,
  stripControlFields,
  type OperationTokenStore,
} from "./operation-token.js";
import type { ApprovalService } from "./approval-service.js";

export interface DryRunResult {
  preview: ToolPreview;
  digest: string;
  operationToken?: string;
  operationTokenExpiresAt?: number;
  approvalToken?: string;
  approvalExpiresAt?: number;
}

/**
 * Runs a write tool's `preview()` and, per its resolved approval policy,
 * issues a digest-bound operation token and/or requests human approval.
 * This is the only path that can produce a valid operation token or
 * approval request — `execute()` never issues one for itself. SPEC.md §7.
 *
 * Registered as the separate `preview_<tool_name>` MCP tool by
 * src/server/create-server.ts — see docs/ADDING-A-TOOL.md for the wire-level
 * preview → approve → execute flow.
 */
export async function runDryRun<TInput, TOutput, TVendor extends VendorClient>(
  tool: ToolDefinition<TInput, TOutput, TVendor>,
  input: TInput,
  context: ToolContext<TVendor>,
  tokenStore: OperationTokenStore,
  approvalService: ApprovalService,
): Promise<DryRunResult> {
  if (!tool.preview) {
    throw new Error(
      `Tool "${tool.name}" has no preview() — this indicates a scaffold bug, not a caller error.`,
    );
  }

  const preview = await tool.preview(input, context);
  const digest = computeOperationDigest({
    tool: tool.name,
    tenantId: context.tenant.tenantId,
    // Inputs are always objects (defineTool requires a z.object() inputSchema) —
    // strip operationToken/approvalToken, which don't exist yet at this point in
    // the flow, so the digest is stable between preview and the later execute call.
    input: stripControlFields(input as Record<string, unknown>),
    proposedChanges: preview.proposedChanges,
  });

  const result: DryRunResult = { preview, digest };
  const ttlSeconds = tool.idempotency.ttlSeconds ?? 900;

  if (tool.approvalPolicy.operationTokenRequired) {
    const issued = tokenStore.issue(digest, ttlSeconds);
    result.operationToken = issued.token;
    result.operationTokenExpiresAt = issued.expiresAt;
  }

  if (tool.approvalPolicy.humanApprovalRequired) {
    const pending = approvalService.requestApproval(
      digest,
      context.principal.subjectId,
      ttlSeconds,
    );
    result.approvalToken = pending.approvalToken;
    result.approvalExpiresAt = pending.expiresAt;
  }

  return result;
}
