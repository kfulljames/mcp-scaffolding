import type { AnyToolDefinition } from "../tools/tool-definition.js";
import type { PermissionRequirement } from "../auth/authorization-policy.js";

export class DuplicateToolError extends Error {
  constructor(name: string) {
    super(`Tool "${name}" is already registered — tool names must be unique per server.`);
    this.name = "DuplicateToolError";
  }
}

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`No tool named "${name}" is registered.`);
    this.name = "UnknownToolError";
  }
}

export interface ToolCatalogueEntry {
  name: string;
  description: string;
  preset: string[];
  accessMode: "read" | "write";
  risk: string;
  approvalPolicy: AnyToolDefinition["approvalPolicy"];
}

/**
 * Holds every tool this server knows about, and derives every downstream
 * view (presets, permission manifest, read-only filtering, catalogue) from
 * that one collection — SPEC.md §4's "one source of truth" applied at the
 * server level, not just the individual tool level.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): this {
    if (this.tools.has(tool.name)) {
      throw new DuplicateToolError(tool.name);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: AnyToolDefinition[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): AnyToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new UnknownToolError(name);
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  all(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  /**
   * Derives preset -> tool-name membership straight from each tool's own
   * `preset` declaration — there is no separately hand-maintained preset
   * table to drift out of sync (SPEC.md §4/§5).
   */
  derivePresets(): Record<string, string[]> {
    const presets: Record<string, string[]> = {};
    for (const tool of this.all()) {
      for (const presetName of tool.preset) {
        (presets[presetName] ??= []).push(tool.name);
      }
    }
    return presets;
  }

  /** Tools belonging to any of the named presets, deduplicated. Throws on an unknown preset name. */
  resolvePresets(presetNames: string[]): AnyToolDefinition[] {
    const derived = this.derivePresets();
    const seen = new Set<string>();
    const result: AnyToolDefinition[] = [];
    for (const presetName of presetNames) {
      const toolNames = derived[presetName];
      if (!toolNames) {
        throw new Error(
          `Unknown preset "${presetName}". Known presets: ${Object.keys(derived).join(", ") || "(none)"}.`,
        );
      }
      for (const toolName of toolNames) {
        if (!seen.has(toolName)) {
          seen.add(toolName);
          result.push(this.get(toolName));
        }
      }
    }
    return result;
  }

  /**
   * Removes every write tool. This is what READ_ONLY=true wires into —
   * write tools are absent from the advertised surface entirely, not
   * merely blocked at call time (SPEC.md §13 definition-of-done item).
   */
  filterReadOnly(tools: AnyToolDefinition[], readOnly: boolean): AnyToolDefinition[] {
    return readOnly ? tools.filter((t) => t.access.mode === "read") : tools;
  }

  generateCatalogue(): ToolCatalogueEntry[] {
    return this.all()
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        preset: tool.preset,
        accessMode: tool.access.mode,
        risk: tool.access.risk,
        approvalPolicy: tool.approvalPolicy,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Auto-derived from tool metadata, never hand-written — SPEC.md §13. */
  generatePermissionManifest(): Record<string, PermissionRequirement> {
    const manifest: Record<string, PermissionRequirement> = {};
    for (const tool of this.all()) {
      manifest[tool.name] = tool.access.permissions;
    }
    return manifest;
  }
}
