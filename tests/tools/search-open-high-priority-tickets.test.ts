import { describe, expect, it } from "vitest";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { createTestContext } from "../helpers/context.js";

describe("mockvendor_search_open_high_priority_tickets", () => {
  it("returns only open, high-or-critical tickets, minimized to the declared fields", async () => {
    const context = createTestContext();
    const result = await searchOpenHighPriorityTickets.execute({ limit: 25 }, context);

    expect(result.tickets.length).toBeGreaterThan(0);
    for (const ticket of result.tickets) {
      expect(["high", "critical"]).toContain(ticket.priority);
      expect(Object.keys(ticket).sort()).toEqual([
        "boardId",
        "id",
        "priority",
        "summary",
      ]);
    }
    // tenant-b's "closed" and "medium" tickets must never appear for tenant-a's context.
    expect(result.tickets.some((t) => t.id === 101)).toBe(false);
  });

  it("filters by boardIds when provided", async () => {
    const context = createTestContext();
    const result = await searchOpenHighPriorityTickets.execute(
      { boardIds: [2], limit: 25 },
      context,
    );
    expect(result.tickets.every((t) => t.boardId === 2)).toBe(true);
  });

  it("reports hasMore when more results exist than the requested limit", async () => {
    const context = createTestContext();
    const result = await searchOpenHighPriorityTickets.execute({ limit: 1 }, context);
    expect(result.tickets).toHaveLength(1);
    expect(result.hasMore).toBe(true);
  });

  it("rejects a limit above the schema's max via input validation, not a runtime error", () => {
    const parsed = searchOpenHighPriorityTickets.inputSchema.safeParse({ limit: 500 });
    expect(parsed.success).toBe(false);
  });
});
