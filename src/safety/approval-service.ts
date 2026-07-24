import { randomBytes } from "node:crypto";

export interface PendingApproval {
  approvalToken: string;
  digest: string;
  requestedBy: string;
  expiresAt: number;
}

export interface ApprovalRecord {
  digest: string;
  approverId: string;
  approvedAt: number;
}

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * Human-approval workflow for `risk: "high"` writes (SPEC.md §7). This is
 * intentionally a separate concept from an operation token: an operation
 * token proves "a preview was shown"; an approval proves "a specific human
 * signed off on this exact digest." A tool requiring both needs a valid,
 * unexpired instance of each.
 *
 * `requestApproval` is where a real deployment would push a notification
 * (Slack, email, an approvals UI) — this reference implementation just
 * records the pending request in memory. Same horizontal-scaling caveat as
 * InMemoryOperationTokenStore applies: swap for a shared store in
 * production. See docs/KNOWN-GOTCHAS.md.
 */
export interface ApprovalService {
  requestApproval(
    digest: string,
    requestedBy: string,
    ttlSeconds: number,
  ): PendingApproval;
  /**
   * Records that `approverId` approved `approvalToken`. Enforces
   * separation of duties (approver ≠ requester) when `requireDistinctApprover`
   * is true — configurable per tool via ToolAccess, since not every deployment
   * has more than one human available to approve.
   */
  approve(
    approvalToken: string,
    approverId: string,
    options?: { requireDistinctApprover?: boolean },
  ): ApprovalRecord;
  /** Consumes (single-use) a prior approval matching `digest`, if one exists and hasn't expired. */
  consumeApproval(digest: string): ApprovalRecord;
}

export class InMemoryApprovalService implements ApprovalService {
  private readonly pending = new Map<
    string,
    { digest: string; requestedBy: string; expiresAt: number }
  >();
  private readonly approved = new Map<string, ApprovalRecord & { expiresAt: number }>();

  requestApproval(
    digest: string,
    requestedBy: string,
    ttlSeconds: number,
  ): PendingApproval {
    const approvalToken = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.pending.set(approvalToken, { digest, requestedBy, expiresAt });
    return { approvalToken, digest, requestedBy, expiresAt };
  }

  approve(
    approvalToken: string,
    approverId: string,
    options?: { requireDistinctApprover?: boolean },
  ): ApprovalRecord {
    const request = this.pending.get(approvalToken);
    this.pending.delete(approvalToken);

    if (!request) {
      throw new ApprovalError(
        "Approval request is invalid, expired, or already resolved.",
      );
    }
    if (request.expiresAt < Date.now()) {
      throw new ApprovalError("Approval request has expired.");
    }
    if (
      options?.requireDistinctApprover !== false &&
      approverId === request.requestedBy
    ) {
      throw new ApprovalError(
        "This tool requires separation of duties: the approver must differ from the requester.",
      );
    }

    const record: ApprovalRecord = {
      digest: request.digest,
      approverId,
      approvedAt: Date.now(),
    };
    // Approvals themselves are short-lived too — a stale approval sitting around
    // is a standing bypass of the safety gate it exists to enforce.
    this.approved.set(request.digest, {
      ...record,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return record;
  }

  consumeApproval(digest: string): ApprovalRecord {
    const record = this.approved.get(digest);
    this.approved.delete(digest);
    if (!record) {
      throw new ApprovalError("No valid human approval found for this exact operation.");
    }
    if (record.expiresAt < Date.now()) {
      throw new ApprovalError("Human approval has expired.");
    }
    return record;
  }
}
