# Nucleus MCP Scaffold

## Authority

- `SPEC.md` is normative — the non-negotiable architecture (SPEC.md §1–§16).
- `MCP-SCAFFOLD-REFERENCE.md` is research memory (patterns observed in real MCP repos), not a
  build spec — don't re-derive decisions from it that `SPEC.md` already made.
- Framework code (`src/server/`, `src/auth/`, `src/safety/`, `src/observability/`,
  `src/config/`) is shared infrastructure every server built from this template inherits —
  see SPEC.md §3, §14. It is not reimplemented or copy-pasted per project.
- A vendor server cloned FROM this template contains mostly `src/vendor/`,
  `src/tools/{read,write}/`, and tool registrations — the vendor-specific ~20%.

## Required commands

Run before considering any change to `src/`, `examples/`, or `tests/` complete:

```bash
npm run verify
```

This runs format check, typecheck, lint, **`test:coverage`** (not plain `test` — coverage
thresholds are a real gate, see `docs/KNOWN-GOTCHAS.md`), build, and catalogue generation, in
that order — the same set CI enforces. `npm test` alone is fine for the fast inner loop while
iterating, but passing `npm test` does not mean CI will pass; only `npm run verify` does.

## Non-negotiables

These are enforced by the framework itself (`src/tools/tool-definition.ts`, `src/safety/`),
but hold them as invariants when writing or reviewing any change — a framework check firing
means fix the declaration, not work around the check:

- Never trust tenant identity from a tool's input arguments — resolution happens through
  `TenantResolver` against the authenticated principal (SPEC.md §2, §6).
- Never accept vendor secrets from a client request — they're resolved server-side through
  `CredentialProvider` (SPEC.md §6, `docs/SECURITY.md`).
- Never register a tool outside `defineTool()` — it's the single source of truth for
  registration, permissions, risk, and catalogue/test generation (SPEC.md §4).
- Never return an unminimized vendor payload — `outputSchema` strips it structurally; declare
  the schema correctly rather than defensively re-stripping fields in `execute()`.
- Never weaken a framework-derived write control — `defineTool()` throws
  `WeakApprovalPolicyError` at registration time if a declared approval policy is weaker than
  its risk tier's floor, and rejects any write tool named with delete/remove semantics that
  isn't `risk: "high"` (`src/tools/risk-level.ts`, `src/tools/tool-definition.ts`).
- Never retry a write without a verified idempotency strategy (SPEC.md §7, §9).
- Never call `fetch()` directly — route through `VendorHttpClient`
  (`src/vendor/http-client.ts`). ESLint enforces this.
- Never use `console.*` — use the structured logger (`src/observability/logger.ts`), which
  redacts automatically. ESLint enforces this.
- Never claim a task complete with a failing or skipped verification gate.

## Workflow

Use the `nucleus-mcp-builder` skill (`.claude/skills/nucleus-mcp-builder/SKILL.md`) for
adding tools, presets, or vendor adapters, or for reviewing an MCP server against
`SPEC.md` — it routes to the specific doc for the task instead of requiring the whole spec
read every time. For anything touching `src/auth/`, `src/safety/`, `src/tools/`, or
`src/server/`, prefer dispatching the `mcp-security-reviewer` and, for protocol/transport
changes, `mcp-protocol-reviewer` agents (`.claude/agents/`) before calling the work done.

If an implementation need contradicts `SPEC.md`, stop and say so explicitly rather than
silently reinterpreting the spec — flag it in the PR description (see the threat-model-delta
section of `.github/pull_request_template.md`), and if it's a recurring gotcha, add it to
`docs/KNOWN-GOTCHAS.md`.

## Where things live

| Task                                                      | Start here                          |
| --------------------------------------------------------- | ----------------------------------- |
| Add a tool                                                | `docs/ADDING-A-TOOL.md`             |
| Add or understand a preset                                | `docs/ADDING-A-PRESET.md`           |
| Auth, tenancy, credentials                                | `docs/AUTHENTICATION.md`            |
| Any security question                                     | `docs/SECURITY.md`                  |
| Deploying                                                 | `docs/DEPLOYMENT.md`                |
| A host integrating write approvals                        | `docs/HOST-INTEGRATION-CONTRACT.md` |
| Known footguns                                            | `docs/KNOWN-GOTCHAS.md`             |
| Full per-server checklist                                 | `DEVELOPMENT-CHECKLIST.md`          |
| Changing the scaffold itself (not a server built from it) | `CONTRIBUTING.md`                   |
