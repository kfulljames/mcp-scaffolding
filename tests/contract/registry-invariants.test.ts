import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/server/tool-registry.js";
import {
  defineTool,
  InvalidToolDefinitionError,
} from "../../src/tools/tool-definition.js";
import { RISK_BASELINE, WeakApprovalPolicyError } from "../../src/tools/risk-level.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { closeTicket } from "../../examples/write-tool.js";
import { listTickets } from "../../examples/paginated-tool.js";

/**
 * Structural invariants checked ACROSS EVERY REGISTERED TOOL, generically, rather than
 * one-off per named tool. Most of these are already enforced by `defineTool()` at
 * registration time (see tests/contract/tool-definition.test.ts for those) — this suite is
 * the backstop that proves the registry as a whole reflects that, and is what a new tool
 * added to this server automatically inherits without anyone writing a bespoke test for it.
 * SPEC.md §13 (definition of done) is the checklist this suite turns into assertions.
 */
const registry = new ToolRegistry().registerAll([
  searchOpenHighPriorityTickets,
  closeTicket,
  listTickets,
]);
const tools = registry.all();

describe("registry-wide compliance invariants", () => {
  it("has at least one real tool registered — a passing empty suite proves nothing", () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it.each(tools)("$name: has both input and output schemas", (tool) => {
    expect(tool.inputSchema).toBeDefined();
    expect(tool.outputSchema).toBeDefined();
  });

  it.each(tools)("$name: is assigned to at least one preset", (tool) => {
    expect(tool.preset.length).toBeGreaterThan(0);
  });

  it.each(tools)("$name: declares non-empty structured permissions", (tool) => {
    const perms = tool.access.permissions;
    if ("allOf" in perms && perms.allOf) {
      expect(perms.allOf.length).toBeGreaterThan(0);
    } else if ("anyOf" in perms) {
      expect(perms.anyOf.length).toBeGreaterThan(0);
    } else {
      throw new Error(`${tool.name} declares neither allOf nor anyOf`);
    }
  });

  it.each(tools.filter((t) => t.access.mode === "write"))(
    "$name (write): implements preview()",
    (tool) => {
      expect(tool.preview).toBeTypeOf("function");
    },
  );

  it.each(tools)(
    "$name: approval policy meets or exceeds its risk tier's framework floor",
    (tool) => {
      const baseline = RISK_BASELINE[tool.access.risk];
      for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
        if (baseline[key]) {
          expect(tool.approvalPolicy[key]).toBe(true);
        }
      }
    },
  );

  it("READ_ONLY=true removes every write tool from the active surface", () => {
    const active = registry.filterReadOnly(tools, true);
    expect(active.every((t) => t.access.mode === "read")).toBe(true);
    expect(active.length).toBeLessThan(tools.length);
  });

  it("the permission manifest has exactly one entry per registered tool", () => {
    const manifest = registry.generatePermissionManifest();
    expect(Object.keys(manifest).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("the tool catalogue includes every registered tool exactly once", () => {
    const catalogue = registry.generateCatalogue();
    expect(catalogue.map((c) => c.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });
});

describe("the invariants above actually catch violations, not just tautologically pass", () => {
  it("defineTool() rejects a delete-named write tool declared below risk high", () => {
    expect(() =>
      defineTool({
        name: "vendor_delete_thing",
        description: "test",
        preset: ["demo"],
        access: {
          mode: "write",
          permissions: { allOf: ["thing.delete"] },
          risk: "medium",
        },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        preview: async () => ({ action: "x", target: "x", proposedChanges: {} }),
        execute: async () => ({}),
      }),
    ).toThrow(InvalidToolDefinitionError);
  });

  it("defineTool() rejects a write tool with an approval policy weaker than its risk floor", () => {
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
        approval: { operationTokenRequired: false },
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        preview: async () => ({ action: "x", target: "x", proposedChanges: {} }),
        execute: async () => ({}),
      }),
    ).toThrow(WeakApprovalPolicyError);
  });

  it("documents the real trust boundary: ToolRegistry does not re-validate — defineTool() is the only gate", () => {
    // A tool bypassing defineTool() (constructed by hand, or built from an older scaffold
    // version before a check existed) is NOT re-checked by ToolRegistry.register(). This is
    // intentional — re-validating here would duplicate defineTool()'s logic in a second
    // place — but it means the invariants above are only as good as "every tool actually
    // went through defineTool()." If this test ever fails (the orphaned tool gets rejected),
    // ToolRegistry has grown its own validation and this comment is stale — update it rather
    // than "fixing" the test.
    const orphanedTool = {
      ...searchOpenHighPriorityTickets,
      name: "vendor_orphan_tool",
      preset: [],
    };
    const isolatedRegistry = new ToolRegistry().register(orphanedTool);
    expect(isolatedRegistry.get("vendor_orphan_tool").preset).toEqual([]);
  });
});
