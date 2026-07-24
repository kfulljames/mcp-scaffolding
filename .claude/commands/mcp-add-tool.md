---
description: Add a single tool (read or write) to an existing MCP server built on this scaffold.
argument-hint: <what the tool should do, e.g. "search open tickets by priority">
---

Use the `nucleus-mcp-builder` skill and `docs/ADDING-A-TOOL.md` to add a tool for: $ARGUMENTS

Follow `docs/ADDING-A-TOOL.md` step by step:

1. Confirm it's task-shaped, not a raw endpoint wrapper — the tool should answer a business
   question, not require the caller to assemble filter syntax.
2. Classify read or write and assign a risk level (SPEC.md §7 table). Deletes are always `high`.
3. Define `inputSchema`/`outputSchema` as `z.object({...})` — `defineTool()` rejects anything else.
4. Implement `execute()` (and `preview()` if it's a write) against the existing `VendorClient` —
   never call `fetch()` directly.
5. Assign the tool to a preset.
6. Add a contract test (malformed input rejected, output matches schema exactly). For a write
   tool, also add a security test modeled on `tests/security/write-safety.test.ts`.
7. Run `npm run verify` and confirm `tests/contract/registry-invariants.test.ts` still passes —
   it checks structural invariants across every registered tool automatically.

If this is a write tool, also flag `docs/HOST-INTEGRATION-CONTRACT.md` — the host driving this
server needs to actually support the preview/approve flow before this tool should ship enabled.
