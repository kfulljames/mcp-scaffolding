import { describe, expect, it, vi } from "vitest";
import {
  ApprovalError,
  InMemoryApprovalService,
} from "../../src/safety/approval-service.js";

describe("InMemoryApprovalService.approve", () => {
  it("rejects an unknown/already-consumed approval token", () => {
    const service = new InMemoryApprovalService();
    expect(() => service.approve("never-issued-token", "approver-1")).toThrow(
      ApprovalError,
    );
  });

  it("rejects an approval token that has expired", () => {
    vi.useFakeTimers();
    try {
      const service = new InMemoryApprovalService();
      const pending = service.requestApproval("digest-1", "requester-1", 1); // 1 second TTL
      vi.advanceTimersByTime(2000);
      expect(() => service.approve(pending.approvalToken, "approver-1")).toThrow(
        /expired/,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a consumed token cannot be approved twice", () => {
    const service = new InMemoryApprovalService();
    const pending = service.requestApproval("digest-1", "requester-1", 900);
    service.approve(pending.approvalToken, "approver-1");
    expect(() => service.approve(pending.approvalToken, "approver-2")).toThrow(
      ApprovalError,
    );
  });

  it("requireDistinctApprover: false allows the requester to approve their own request", () => {
    const service = new InMemoryApprovalService();
    const pending = service.requestApproval("digest-1", "same-person", 900);
    expect(() =>
      service.approve(pending.approvalToken, "same-person", {
        requireDistinctApprover: false,
      }),
    ).not.toThrow();
  });
});

describe("InMemoryApprovalService.consumeApproval", () => {
  it("rejects when no approval exists for the digest", () => {
    const service = new InMemoryApprovalService();
    expect(() => service.consumeApproval("never-approved-digest")).toThrow(ApprovalError);
  });

  it("rejects a stale approval past its own short TTL", () => {
    vi.useFakeTimers();
    try {
      const service = new InMemoryApprovalService();
      const pending = service.requestApproval("digest-1", "requester-1", 900);
      service.approve(pending.approvalToken, "approver-1");
      vi.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute approval TTL
      expect(() => service.consumeApproval("digest-1")).toThrow(/expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("consuming an approval is single-use", () => {
    const service = new InMemoryApprovalService();
    const pending = service.requestApproval("digest-1", "requester-1", 900);
    service.approve(pending.approvalToken, "approver-1");
    service.consumeApproval("digest-1");
    expect(() => service.consumeApproval("digest-1")).toThrow(ApprovalError);
  });
});
