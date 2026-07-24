/**
 * Presets are named, explicit tool bundles — an exact allow-list, never a
 * fuzzy match (SPEC.md §5). This scaffold derives the preset -> tool-name
 * map from each tool's own `preset` declaration (see
 * `ToolRegistry.derivePresets`) rather than maintaining a second,
 * hand-written table like:
 *
 * ```ts
 * export const presets = {
 *   "service-desk": ["search_open_high_priority_tickets", "get_ticket"],
 * };
 * ```
 *
 * A hand-written table like that is one more place preset membership can
 * drift from what a tool actually declares — SPEC.md §4 is explicit that
 * everything (registration, preset membership, permissions, docs, tests)
 * comes from one source of truth. If your team prefers the literal table
 * for readability, generate it with `npm run generate:catalogue` and treat
 * the output as documentation, not a second source of truth to hand-edit.
 *
 * Launch modes (SPEC.md §5), unchanged:
 * ```
 * MCP_PRESETS=service-desk npm start
 * MCP_PRESETS=service-desk,admin npm start
 * ```
 */
export function parsePresetNames(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
