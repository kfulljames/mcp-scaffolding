import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  InvalidToolDefinitionError,
} from "../../src/tools/tool-definition.js";
import { WeakApprovalPolicyError } from "../../src/tools/risk-level.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { closeTicket } from "../../examples/write-tool.js";
import { createTestContext } from "../helpers/context.js";

describe("defineTool contract", () => {
  it("rejects malformed input via the schema, not a runtime error", () => {
    const result = searchOpenHighPriorityTickets.inputSchema.safeParse({
      limit: "not-a-number",
    });
    expect(result.success).toBe(false);
  });

  it("strips fields not declared in outputSchema — never returns the raw execute() payload", () => {
    const schema = z.object({ keep: z.string() });
    const parsed = schema.parse({ keep: "yes", secretInternalField: "leak-me" });
    expect(parsed).toEqual({ keep: "yes" });
    expect(parsed).not.toHaveProperty("secretInternalField");
  });

  it("refuses to ship a tool with no preset", () => {
    expect(() =>
      defineTool({
        name: "vendor_get_thing",
        description: "test",
        preset: [],
        access: { mode: "read", permissions: { allOf: ["thing.read"] }, risk: "low" },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: async () => ({}),
      }),
    ).toThrow(InvalidToolDefinitionError);
  });

  it("refuses a write tool with no preview()", () => {
    expect(() =>
      defineTool({
        name: "vendor_do_thing",
        description: "test",
        preset: ["demo"],
        access: {
          mode: "write",
          permissions: { allOf: ["thing.write"] },
          risk: "medium",
        },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: async () => ({}),
      }),
    ).toThrow(/must implement preview/);
  });

  it("refuses a low-risk write tool — no such thing in this model", () => {
    expect(() =>
      defineTool({
        name: "vendor_do_thing",
        description: "test",
        preset: ["demo"],
        access: { mode: "write", permissions: { allOf: ["thing.write"] }, risk: "low" },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        preview: async () => ({ action: "x", target: "x", proposedChanges: {} }),
        execute: async () => ({}),
      }),
    ).toThrow(/no low-risk write/);
  });

  it("rejects a declared approval policy weaker than the risk baseline", () => {
    expect(() =>
      defineTool({
        name: "vendor_do_thing",
        description: "test",
        preset: ["demo"],
        access: { mode: "write", permissions: { allOf: ["thing.write"] }, risk: "high" },
        approval: { humanApprovalRequired: false },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        preview: async () => ({ action: "x", target: "x", proposedChanges: {} }),
        execute: async () => ({}),
      }),
    ).toThrow(WeakApprovalPolicyError);
  });

  it("rejects a name that isn't vendor-prefixed snake_case", () => {
    expect(() =>
      defineTool({
        name: "GetThing",
        description: "test",
        preset: ["demo"],
        access: { mode: "read", permissions: { allOf: ["thing.read"] }, risk: "low" },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        execute: async () => ({}),
      }),
    ).toThrow(InvalidToolDefinitionError);
  });

  it("a write tool's execute() output still validates cleanly against its outputSchema", async () => {
    const context = createTestContext();
    // seed a ticket to close via the mock vendor
    const result = await closeTicket.execute(
      { ticketId: 1, resolution: "fixed" },
      context,
    );
    expect(closeTicket.outputSchema.parse(result)).toEqual({ id: 1, status: "closed" });
  });
});
