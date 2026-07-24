import type { ToolDefinition } from "../tools/tool-definition.js";
import type { ToolContext } from "../tools/tool-context.js";
import type { VendorClient } from "../vendor/client.js";
import {
  computeOperationDigest,
  stripControlFields,
  type OperationTokenStore,
} from "./operation-token.js";
import type { ApprovalService } from "./approval-service.js";

export class WriteVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteVerificationError";
  }
}

/**
 * The execute-side half of the write safety lifecycle (SPEC.md §7). Never
 * trusts the caller's word that a preview happened — it re-derives the
 * digest by re-running the tool's (side-effect-free, by contract) `preview()`
 * against the CURRENT input, then requires that digest to match a live,
 * unexpired, single-use operation token (and, for high-risk tools, a live
 * human approval) before `execute()` ever runs.
 *
 * If the caller changed the input after preview, the re-derived digest
 * differs from what was approved and this rejects the call — that's the
 * "changing the payload after approval invalidates it" guarantee.
 */
export async function verifyAndExecuteWrite<
  TInput extends { operationToken?: string; approvalToken?: string },
  TOutput,
  TVendor extends VendorClient,
>(
  tool: ToolDefinition<TInput, TOutput, TVendor>,
  input: TInput,
  context: ToolContext<TVendor>,
  tokenStore: OperationTokenStore,
  approvalService: ApprovalService,
): Promise<TOutput> {
  if (
    !tool.approvalPolicy.operationTokenRequired &&
    !tool.approvalPolicy.humanApprovalRequired
  ) {
    return tool.execute(input, context);
  }

  if (!tool.preview) {
    throw new Error(
      `Tool "${tool.name}" requires approval but has no preview() — scaffold bug.`,
    );
  }

  const preview = await tool.preview(input, context);
  const digest = computeOperationDigest({
    tool: tool.name,
    tenantId: context.tenant.tenantId,
    // Must match runDryRun's stripping exactly, or every legitimate token fails
    // digest verification — see stripControlFields's doc comment.
    input: stripControlFields(input as Record<string, unknown>),
    proposedChanges: preview.proposedChanges,
  });

  if (tool.approvalPolicy.operationTokenRequired) {
    if (!input.operationToken) {
      throw new WriteVerificationError(
        `"${tool.name}" requires a preceding dry run. Call preview_${tool.name} first and pass ` +
          "the returned operationToken.",
      );
    }
    // Throws on missing/expired/reused/mismatched token — see operation-token.ts.
    tokenStore.consume(input.operationToken, digest);
  }

  if (tool.approvalPolicy.humanApprovalRequired) {
    if (!input.approvalToken) {
      throw new WriteVerificationError(
        `"${tool.name}" is high-risk and requires a human approval. Have an authorized approver ` +
          "call approve_operation with the approvalToken returned by the preview step.",
      );
    }
    // consumeApproval is keyed by digest, not by the approvalToken itself — the
    // approvalToken was only ever used to let approve_operation record the approval.
    approvalService.consumeApproval(digest);
  }

  return tool.execute(input, context);
}
