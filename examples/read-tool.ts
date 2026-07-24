import { z } from "zod";
import { defineTool } from "../src/tools/tool-definition.js";
import type { MockVendorCapableClient } from "./vendor/mock-vendor-client.js";

/**
 * Canonical read tool example. Task-shaped (SPEC.md §1/§4's "search_open_
 * high_priority_tickets, not a raw endpoint wrapper") — the model asks for
 * a business concept, not a REST query it has to assemble filter syntax
 * for. Copy this file's shape, not its literal contents, for a real tool:
 * rename, point `execute` at your real VendorClient capability, and adjust
 * inputSchema/outputSchema to match your domain.
 */
const ticketSummarySchema = z.object({
  id: z.number(),
  summary: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  boardId: z.number(),
});

export const searchOpenHighPriorityTickets = defineTool({
  name: "mockvendor_search_open_high_priority_tickets",
  description:
    "Searches for open, high-or-critical-priority service tickets for the authenticated tenant. " +
    "Read-only; does not include closed, low, or medium priority tickets.",

  preset: ["service-desk"],

  access: {
    mode: "read",
    permissions: { allOf: ["tickets.read"] },
    risk: "low",
  },

  inputSchema: z.object({
    boardIds: z
      .array(z.number())
      .optional()
      .describe("Restrict results to these board IDs, if provided."),
    limit: z.number().min(1).max(100).default(25),
  }),

  outputSchema: z.object({
    tickets: z.array(ticketSummarySchema),
    hasMore: z.boolean(),
  }),

  async execute(input, context: { vendor: MockVendorCapableClient }) {
    const tickets = await context.vendor.ticketsService.searchOpenHighPriority({
      boardIds: input.boardIds,
      // Fetch one extra to cheaply detect "more available" without a separate count call.
      limit: input.limit + 1,
    });

    const hasMore = tickets.length > input.limit;
    const page = tickets.slice(0, input.limit);

    // Minimize: only the fields declared in outputSchema leave this function,
    // regardless of what the vendor client happens to return (SPEC.md §4, §8).
    return {
      tickets: page.map((t) => ({
        id: t.id,
        summary: t.summary,
        priority: t.priority,
        boardId: t.boardId,
      })),
      hasMore,
    };
  },
});
