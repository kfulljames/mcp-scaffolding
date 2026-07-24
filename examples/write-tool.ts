import { z } from "zod";
import { defineTool } from "../src/tools/tool-definition.js";
import type { MockVendorCapableClient } from "./vendor/mock-vendor-client.js";

/**
 * Canonical write tool example — `medium` risk, so it requires a preceding
 * dry run and a valid operation token but not human approval (compare
 * against a `risk: "high"` tool, e.g. a delete, which would additionally
 * require approve_operation — see docs/ADDING-A-TOOL.md).
 *
 * `operationToken` is declared directly on the input schema: the server
 * layer (src/server/create-server.ts) re-derives the expected digest by
 * re-running `preview()` against the current input and checks it against
 * this token — see src/safety/write-executor.ts. A tool author never
 * verifies the token themselves.
 */
const inputSchema = z.object({
  ticketId: z.number(),
  resolution: z.string().min(1).max(2000),
  operationToken: z
    .string()
    .optional()
    .describe(
      "From preview_mockvendor_close_ticket. Required to actually execute this tool.",
    ),
});

export const closeTicket = defineTool({
  name: "mockvendor_close_ticket",
  description:
    "Closes a service ticket with the given resolution. Write; requires a preceding " +
    "preview_mockvendor_close_ticket call and its operationToken. Does not reopen or delete tickets.",

  preset: ["service-desk"],

  access: {
    mode: "write",
    permissions: { allOf: ["tickets.write"] },
    risk: "medium",
  },

  idempotency: { strategy: "operation-token", ttlSeconds: 900 },

  inputSchema,

  outputSchema: z.object({
    id: z.number(),
    status: z.literal("closed"),
  }),

  async preview(input, context: { vendor: MockVendorCapableClient }) {
    const ticket = await context.vendor.ticketsService.getTicket(input.ticketId);
    return {
      action: "Close ticket",
      target: String(ticket.id),
      proposedChanges: { status: "closed", resolution: input.resolution },
    };
  },

  async execute(input, context: { vendor: MockVendorCapableClient }) {
    const ticket = await context.vendor.ticketsService.closeTicket(
      input.ticketId,
      input.resolution,
    );
    return { id: ticket.id, status: "closed" as const };
  },
});
