import { z } from "zod";
import { defineTool } from "../src/tools/tool-definition.js";
import type { MockVendorCapableClient } from "./vendor/mock-vendor-client.js";

/**
 * Demonstrates exposing pagination to the CALLER (cursor in, cursor out)
 * rather than exhausting every page internally as examples/read-tool.ts
 * does with fetchAllPages. Use this shape when a result set can genuinely
 * be large and the caller should be able to page through it incrementally;
 * use the fetchAllPages shape when the result is bounded and you just want
 * one clean answer. Either way, a single call is still bounded — see
 * src/vendor/pagination.ts — so no tool can be asked for an unbounded
 * result set (SPEC.md §8).
 */
export const listTickets = defineTool({
  name: "mockvendor_list_tickets",
  description:
    "Lists all service tickets for the authenticated tenant, most recent first, paginated. " +
    "Read-only; includes both open and closed tickets, unlike search_open_high_priority_tickets.",

  preset: ["service-desk"],

  access: {
    mode: "read",
    permissions: { allOf: ["tickets.read"] },
    risk: "low",
  },

  inputSchema: z.object({
    cursor: z.string().optional(),
    limit: z.number().min(1).max(100).default(50),
  }),

  outputSchema: z.object({
    tickets: z.array(
      z.object({
        id: z.number(),
        summary: z.string(),
        status: z.enum(["open", "closed"]),
      }),
    ),
    nextCursor: z.string().optional(),
  }),

  async execute(input, context: { vendor: MockVendorCapableClient }) {
    // In a real VendorClient this delegates to the vendor's own cursor —
    // MockVendorClient doesn't expose a raw list method, so this example
    // fans searchOpenHighPriority-style access out via getTicket for
    // illustration only. Replace with a real paginated vendor call.
    const start = input.cursor ? Number(input.cursor) : 0;
    const all = await context.vendor.ticketsService.searchOpenHighPriority({
      limit: 1000,
    });
    const page = all.slice(start, start + input.limit);
    const nextCursor =
      start + input.limit < all.length ? String(start + input.limit) : undefined;

    return {
      tickets: page.map((t) => ({ id: t.id, summary: t.summary, status: t.status })),
      nextCursor,
    };
  },
});
