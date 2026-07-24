import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * ILLUSTRATIVE / OPTIONAL — prompts as a first-class primitive (see
 * MCP-SCAFFOLD-REFERENCE.md, "Prompts as a first-class primitive"). SPEC.md
 * §15 defers a full prompt/workflow *registry* to v2; this file shows the
 * shape a hand-written MCP prompt takes today, for a server that wants one
 * or two guided workflows before the registry exists.
 *
 * A prompt does not call tools itself — it returns a message sequence that
 * *tells the model which tools to call, in what order*. The model still
 * makes the actual tool calls (and is still bound by every safety control
 * on those tools: authorization, read-only filtering, dry-run gates). A
 * prompt is a convenience for assembly, never a way to bypass a tool's
 * access controls.
 *
 * This is NOT wired into src/server/create-server.ts automatically —
 * register it explicitly in your server's bootstrap if you want it:
 * `registerWorkflowPrompts(server)`.
 */
export function registerWorkflowPrompts(server: McpServer): void {
  server.registerPrompt(
    "service_desk_daily_triage",
    {
      description:
        "Guided workflow: review today's open high-priority tickets and draft a summary for handoff.",
      argsSchema: {
        boardId: z
          .string()
          .optional()
          .describe("Restrict triage to a single board, if provided."),
      },
    },
    ({ boardId }: { boardId?: string }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Perform a daily service-desk triage:\n" +
              `1. Call mockvendor_search_open_high_priority_tickets${boardId ? ` for board ${boardId}` : ""}.\n` +
              "2. For each ticket, note age and whether it looks like it needs an owner reassigned.\n" +
              "3. Summarize as a short handoff note grouped by priority. Do not close or modify any ticket " +
              "as part of this workflow — this is read-only triage.",
          },
        },
      ],
    }),
  );
}
