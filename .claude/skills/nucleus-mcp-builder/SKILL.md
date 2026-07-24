---
name: nucleus-mcp-builder
description: Build and modify MCP servers on the Nucleus scaffold — add tools, presets, vendor adapters, and write-safety flows; review an existing MCP server implementation against SPEC.md. Use when asked to create an MCP server, add or modify an MCP tool, integrate a new vendor API, add a preset, add a write or delete operation, or review an MCP server for spec compliance.
---

# Nucleus MCP Builder

`SPEC.md` (repo root) is normative for every MCP server built from this scaffold. This skill
is the operational playbook for using it — read the specific reference below for the task at
hand, not the whole spec every time.

## Before starting any task

Confirm which repo you're in:

- **This scaffold repo** (`mcp-server-scaffold`) — you're changing shared framework code
  (`src/server/`, `src/auth/`, `src/safety/`, `src/observability/`, `src/config/`). Read
  `CONTRIBUTING.md` first — these changes affect every server cloned from this template, not
  just the one in front of you.
- **A vendor server cloned from this scaffold** — you're changing `src/vendor/`,
  `src/tools/{read,write}/`, and tool registrations. Read `DEVELOPMENT-CHECKLIST.md` for the
  full per-server workflow, scaffold through deployment.

## Task → reference

| Task                                    | Read                                                                | Then                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Creating a new server                   | SPEC.md §12, `DEVELOPMENT-CHECKLIST.md`                             | Work through the checklist section by section                                                                                                                                               |
| Adding a read tool                      | `docs/ADDING-A-TOOL.md`                                             | Follow its steps in order; use `examples/read-tool.ts` as the shape to copy                                                                                                                 |
| Adding a write tool                     | `docs/ADDING-A-TOOL.md` + `docs/SECURITY.md`'s write-safety section | Use `examples/write-tool.ts`; assign risk per the SPEC.md §7 table — deletes are always `high`, enforced by `defineTool()`                                                                  |
| Adding or understanding a preset        | `docs/ADDING-A-PRESET.md`                                           | Just declare `preset: [...]` on the tool — there's no separate registry to hand-edit                                                                                                        |
| Wiring auth/tenancy for a new vendor    | `docs/AUTHENTICATION.md`                                            | Implement `TenantResolver` + `CredentialProvider` for the deployment context (single-tenant internal vs. multi-tenant client-facing)                                                        |
| A host needs to support write approvals | `docs/HOST-INTEGRATION-CONTRACT.md`                                 | Confirm the host can render `preview_*` output and drive `approve_operation` with a distinct approver before shipping any write tool to it                                                  |
| Reviewing an MCP server for compliance  | `SPEC.md` §13 (definition of done), `DEVELOPMENT-CHECKLIST.md`      | Dispatch the `mcp-security-reviewer` agent for anything touching auth/safety, and `mcp-protocol-reviewer` for anything touching `src/server/create-server.ts` or `src/server/transports.ts` |
| Deploying                               | `docs/DEPLOYMENT.md`                                                |                                                                                                                                                                                             |

## Non-negotiables (full list in root `CLAUDE.md`)

- Every tool goes through `defineTool()` — never register ad hoc.
- Every write tool needs `preview()`; `risk: "low"` is not valid for a write, and a tool
  named with delete/remove semantics must be `risk: "high"` — both rejected at registration.
- Tenant identity from tool input is a hint, never an authorization.
- Vendor secrets are resolved server-side via `CredentialProvider`, never accepted from a client.
- Don't finish a task with `npm run verify` or `npm run build` failing.

## Implementing a tool, concretely

1. Classify read or write, assign a risk level (SPEC.md §7 table).
2. Define `inputSchema`/`outputSchema` as `z.object({...})` — `defineTool()` rejects anything else.
3. Write `execute()` (and `preview()` for writes) against the server's `VendorClient` — never
   call `fetch()` directly; go through `VendorHttpClient` (`src/vendor/http-client.ts`).
4. Assign at least one `preset`.
5. Add a contract test (malformed input rejected, output matches schema exactly) and, for
   writes, a security test modeled on `tests/security/write-safety.test.ts`. Check
   `tests/contract/registry-invariants.test.ts` still passes — it asserts structural
   invariants across every registered tool generically.
6. Run `npm run verify`.

If a step here conflicts with what you find in the code, trust `docs/ADDING-A-TOOL.md` and
`SPEC.md` over this summary — this file is a map, not the territory.
