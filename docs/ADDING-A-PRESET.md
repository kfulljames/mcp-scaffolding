# Adding a preset

Presets are the v1 tool-discovery mechanism (SPEC.md §5) — named, explicit tool bundles, an
exact allow-list, launched via `MCP_PRESETS=name1,name2`. They exist as a middle ground
between "dump every tool into every session" and full search-based dynamic discovery (v2,
SPEC.md §15) — simpler to implement, and usually enough: most deployments want "the service
desk tools" or "the finance tools," not a search index over 100 endpoints.

## There is no registry to edit

Unlike a lot of plugin systems, you don't maintain a separate `presets.ts` table mapping
preset names to tool lists. A preset is created by using its name:

```ts
export const searchOpenTickets = defineTool({
  name: "mockvendor_search_open_tickets",
  preset: ["service-desk"], // <- this line creates/joins the "service-desk" preset
  // ...
});
```

`ToolRegistry.derivePresets()` builds the full preset → tool-name map by scanning every
registered tool's `preset` array (`src/server/tool-registry.ts`). Add a tool to a new preset
name, and that preset now exists — no other file to touch. Run
`npm run generate:catalogue` to see the derived map as JSON (`generated/presets.json`) if you
want a human-readable view — that file is generated output, not a source of truth to hand-edit.

**Why derived instead of hand-written:** SPEC.md §4 is explicit that everything (registration,
permissions, docs, tests) traces back to one declaration per tool. A hand-maintained preset
table is a second place preset membership can drift from what a tool actually declares —
exactly the kind of duplication this scaffold is designed to prevent.

## Choosing preset boundaries

- Group by _who calls it_, not by vendor API surface. `service-desk` (agents triaging
  tickets) is a better boundary than `tickets` (every ticket-related endpoint, read and
  write, admin and non-admin) — the latter forces a deployment that only wants read triage
  tools to also expose admin write tools it doesn't need.
- A tool can belong to more than one preset (`preset: ["service-desk", "admin"]`) if it
  genuinely serves both audiences. Don't default to this — it's usually a sign the tool (or
  the preset boundary) needs rethinking.
- Keep `admin`/high-privilege tools in their own preset, never folded into a general-purpose
  one, so a deployment can opt in to admin capability explicitly rather than getting it by
  default alongside everyday tools.

## Launching with presets

```bash
MCP_PRESETS=service-desk npm start
MCP_PRESETS=service-desk,admin npm start
```

`MCP_PRESETS` is required (`src/config/schema.ts`) — there's no "expose everything" default.
An unknown preset name fails server startup with the list of valid names
(`ToolRegistry.resolvePresets`), not a silently-empty tool surface.
