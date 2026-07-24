# Contributing to this scaffold

This file is about changing the **scaffold itself** — `src/server/`, `src/auth/`,
`src/safety/`, `src/observability/`, `src/config/`, the test infrastructure, CI. If you're
building a vendor server _from_ this template, you want `docs/ADDING-A-TOOL.md`, not this file.

## What's generated vs. genuinely editable

| Never hand-edit                                          | Freely edit                                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `generated/*.json` (`npm run generate:catalogue` output) | `src/tools/read/`, `src/tools/write/` in a real (non-template) server                   |
| —                                                        | `src/vendor/` in a real server                                                          |
| —                                                        | `src/server/presets.ts` usage (via `preset:` on a tool — see `docs/ADDING-A-PRESET.md`) |

Everything under `src/server/`, `src/auth/`, `src/safety/`, `src/observability/`,
`src/config/` is framework code shared by every server cloned from this template — SPEC.md §3
is explicit that vendor repos don't reimplement or copy-paste it. Changing it here is a
scaffold-level decision, not a per-project one.

## Before proposing a scaffold change

Ask: does this change a safety default, an interface every tool/server depends on, or the
test suite every server inherits? If yes, it needs more scrutiny than a normal PR — a bug
here doesn't affect one server, it affects every server built from this template (SPEC.md §14).

1. Open an issue or discussion describing the change and, critically, **why** — this
   codebase is deliberately opinionated (see every doc's "why," not just "what"). A change
   that quietly weakens a default (e.g., making `outputSchema` optional, loosening the
   `risk: "high"` approval baseline) needs explicit justification, not just convenience.
2. If it changes a mandatory interface (`ToolContext`, `TenantResolver`, `CredentialProvider`,
   `AuthorizationPolicy`, `VendorClient`, the tool definition contract) — that's a breaking
   change for every downstream server. Treat it like a semver-major bump (see "Scaffold
   governance," below) and document the migration path.
3. Run `npm run verify` (typecheck, lint, test, build, catalogue generation) before opening a PR.
4. Update the relevant `docs/*.md` in the same PR — a scaffold change without a docs update is
   incomplete, not a follow-up.

## Scaffold governance (SPEC.md §14)

This repository currently ships as a **clone-and-rename template**, not yet as versioned
packages (`@your-org/mcp-core`, etc. — SPEC.md §14's target state). Until that extraction
happens:

- Treat `main` as the source of truth. A server cloned from this template that wants a
  scaffold fix currently has to manually diff and pull it in — painful, and exactly the
  problem package extraction solves. If you're doing this often enough to hurt, that's the
  signal to prioritize §14's backlog item.
- Security fixes to `src/safety/`, `src/auth/`, or `src/server/` should be flagged loudly
  (not just merged quietly) so downstream server owners know to pull the fix in manually.
- Tool/schema-breaking changes to the contract in `src/tools/tool-definition.ts` need a
  deprecation note here and in `docs/KNOWN-GOTCHAS.md`, not just a changelog entry.

## Code style

- `npm run lint` / `npm run format` — ESLint (flat config, `eslint.config.js`) + Prettier.
  Two rules are intentionally strict, not defaults left on by accident: no `console.*` (bypasses
  redaction — use the logger), no direct `fetch()` outside `VendorHttpClient` (bypasses
  timeout/retry/circuit-breaking). See `docs/KNOWN-GOTCHAS.md`.
- No comments explaining _what_ code does — name things well instead. Comments earn their
  place only for non-obvious _why_ (a constraint, an invariant, a workaround). This file and
  the rest of the scaffold try to hold that bar; hold new code to it too.
- Every new safety-relevant module (auth, safety, observability) needs a docstring-style
  comment at the top explaining what it's for and, where it's a deliberate stub or
  single-instance-only implementation, saying so explicitly — see `EntraAuthenticator` and
  `InMemoryOperationTokenStore` for the pattern.

## Tests

`npm test` / `npm run test:watch` (Vitest). Coverage thresholds are enforced
(`vitest.config.ts`) and set high on purpose — this codebase _is_ the safety mechanism every
downstream server relies on. A scaffold change that drops coverage needs new tests in the same
PR, not a follow-up ticket.
