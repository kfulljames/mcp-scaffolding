import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/server/tool-registry.js";
import { defineTool } from "../../src/tools/tool-definition.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { closeTicket } from "../../examples/write-tool.js";
import {
  InMemoryOperationTokenStore,
  OperationTokenError,
} from "../../src/safety/operation-token.js";
import {
  InMemoryApprovalService,
  ApprovalError,
} from "../../src/safety/approval-service.js";
import { runDryRun } from "../../src/safety/dry-run.js";
import {
  verifyAndExecuteWrite,
  WriteVerificationError,
} from "../../src/safety/write-executor.js";
import { createTestContext, createTestPrincipal } from "../helpers/context.js";

describe("write tools are absent entirely when READ_ONLY=true", () => {
  it("filterReadOnly strips every write tool from the advertised surface", () => {
    const registry = new ToolRegistry().registerAll([
      searchOpenHighPriorityTickets,
      closeTicket,
    ]);
    const active = registry.filterReadOnly(registry.all(), true);
    expect(active.map((t) => t.name)).toEqual([searchOpenHighPriorityTickets.name]);
    expect(active.some((t) => t.access.mode === "write")).toBe(false);
  });

  it("filterReadOnly keeps write tools when READ_ONLY=false", () => {
    const registry = new ToolRegistry().registerAll([
      searchOpenHighPriorityTickets,
      closeTicket,
    ]);
    const active = registry.filterReadOnly(registry.all(), false);
    expect(active).toHaveLength(2);
  });
});

describe("medium-risk write: dry-run + operation token", () => {
  it("cannot execute without a preceding dry run", async () => {
    const context = createTestContext();
    await expect(
      verifyAndExecuteWrite(
        closeTicket,
        { ticketId: 1, resolution: "fixed" },
        context,
        new InMemoryOperationTokenStore(),
        new InMemoryApprovalService(),
      ),
    ).rejects.toThrow(WriteVerificationError);
  });

  it("succeeds with a valid token from preview", async () => {
    const context = createTestContext();
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();

    const dryRun = await runDryRun(
      closeTicket,
      { ticketId: 1, resolution: "fixed" },
      context,
      tokenStore,
      approvalService,
    );
    expect(dryRun.operationToken).toBeDefined();

    const result = await verifyAndExecuteWrite(
      closeTicket,
      { ticketId: 1, resolution: "fixed", operationToken: dryRun.operationToken },
      context,
      tokenStore,
      approvalService,
    );
    expect(result).toEqual({ id: 1, status: "closed" });
  });

  it("rejects an already-used operation token", async () => {
    const context = createTestContext();
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();
    const dryRun = await runDryRun(
      closeTicket,
      { ticketId: 2, resolution: "fixed" },
      context,
      tokenStore,
      approvalService,
    );

    const input = {
      ticketId: 2,
      resolution: "fixed",
      operationToken: dryRun.operationToken,
    };
    await verifyAndExecuteWrite(closeTicket, input, context, tokenStore, approvalService);

    await expect(
      verifyAndExecuteWrite(closeTicket, input, context, tokenStore, approvalService),
    ).rejects.toThrow(OperationTokenError);
  });

  it("rejects a token whose digest doesn't match the (changed) input", async () => {
    const context = createTestContext();
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();
    const dryRun = await runDryRun(
      closeTicket,
      { ticketId: 3, resolution: "original reason" },
      context,
      tokenStore,
      approvalService,
    );

    await expect(
      verifyAndExecuteWrite(
        closeTicket,
        {
          ticketId: 3,
          resolution: "DIFFERENT reason",
          operationToken: dryRun.operationToken,
        },
        context,
        tokenStore,
        approvalService,
      ),
    ).rejects.toThrow(OperationTokenError);
  });

  it("rejects an expired operation token", async () => {
    const tokenStore = new InMemoryOperationTokenStore();
    const digest = "irrelevant-for-this-test";
    const issued = tokenStore.issue(digest, -1); // already expired
    expect(() => tokenStore.consume(issued.token, digest)).toThrow(OperationTokenError);
  });
});

describe("high-risk write requires human approval", () => {
  const deleteThing = defineTool({
    name: "vendor_delete_thing",
    description: "Deletes a thing. High risk by definition — deletes always are.",
    preset: ["demo"],
    access: { mode: "write", permissions: { allOf: ["thing.delete"] }, risk: "high" },
    inputSchema: z.object({
      thingId: z.number(),
      operationToken: z.string().optional(),
      approvalToken: z.string().optional(),
    }),
    outputSchema: z.object({ deleted: z.boolean() }),
    preview: async (input) => ({
      action: "Delete thing",
      target: String(input.thingId),
      proposedChanges: { deleted: true },
    }),
    execute: async () => ({ deleted: true }),
  });

  it("blocks execution without human approval even with a valid operation token", async () => {
    const context = createTestContext();
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();
    const dryRun = await runDryRun(
      deleteThing,
      { thingId: 1 },
      context,
      tokenStore,
      approvalService,
    );
    expect(dryRun.approvalToken).toBeDefined();

    await expect(
      verifyAndExecuteWrite(
        deleteThing,
        { thingId: 1, operationToken: dryRun.operationToken },
        context,
        tokenStore,
        approvalService,
      ),
    ).rejects.toThrow(WriteVerificationError);
  });

  it("enforces separation of duties: the approver cannot be the requester", async () => {
    const requester = createTestPrincipal({ subjectId: "requester" });
    const context = createTestContext({ principal: requester });
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();
    const dryRun = await runDryRun(
      deleteThing,
      { thingId: 2 },
      context,
      tokenStore,
      approvalService,
    );

    expect(() => approvalService.approve(dryRun.approvalToken!, "requester")).toThrow(
      ApprovalError,
    );
  });

  it("succeeds once a distinct approver approves and both tokens are presented", async () => {
    const requester = createTestPrincipal({ subjectId: "requester" });
    const context = createTestContext({ principal: requester });
    const tokenStore = new InMemoryOperationTokenStore();
    const approvalService = new InMemoryApprovalService();
    const dryRun = await runDryRun(
      deleteThing,
      { thingId: 3 },
      context,
      tokenStore,
      approvalService,
    );

    approvalService.approve(dryRun.approvalToken!, "distinct-approver");

    const result = await verifyAndExecuteWrite(
      deleteThing,
      {
        thingId: 3,
        operationToken: dryRun.operationToken,
        approvalToken: dryRun.approvalToken,
      },
      context,
      tokenStore,
      approvalService,
    );
    expect(result).toEqual({ deleted: true });
  });
});
