---
description: Scaffold a new vendor MCP server from this template — wire the vendor client, auth, and the first read tools.
argument-hint: <vendor-name> [domain, e.g. "PSA ticketing"]
---

Use the `nucleus-mcp-builder` skill to create a new MCP server for vendor "$ARGUMENTS" on top
of this scaffold.

Follow SPEC.md §12 ("Creating a new server") and `DEVELOPMENT-CHECKLIST.md` in order:

1. Confirm vendor API documentation and sandbox credentials are available — ask if not provided
   rather than guessing at the API shape.
2. Implement `VendorClient` for the target API (`src/vendor/`), with every outbound call routed
   through `VendorHttpClient` (`src/vendor/http-client.ts`) — never call `fetch()` directly.
3. Configure authentication (`AUTH_MODE`, `TenantResolver`, `CredentialProvider`) per
   `docs/AUTHENTICATION.md`.
4. Add one or two read tools first — never start with writes (SPEC.md §12). Model
   `examples/read-tool.ts`, using `defineTool()`.
5. Assign each tool to a preset (`docs/ADDING-A-PRESET.md`).
6. Run `npm run verify` and confirm it passes before considering any step done.
7. Summarize what's left on `DEVELOPMENT-CHECKLIST.md` before write tools are added — reads
   need to be validated in production use first.

If anything here conflicts with what's actually in the codebase, trust `SPEC.md` and
`docs/ADDING-A-TOOL.md` over this summary.
