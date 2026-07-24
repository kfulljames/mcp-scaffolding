# MCP Server Scaffold

A production-ready, security-first starting point for building [Model Context Protocol](https://modelcontextprotocol.io)
servers. Clone this repo to start every new MCP server — don't start from a blank `npm init`.

This is opinionated on purpose. Every default here exists because of a real gap or incident
pattern observed across MCP servers in the wild (see `MCP-SCAFFOLD-REFERENCE.md`), and the
goal is that **the secure path is the only easy path** — unsafe behavior requires an explicit,
reviewable override, not just theoretical avoidance.

## Start here

| I want to...                                                         | Read                                |
| -------------------------------------------------------------------- | ----------------------------------- |
| Understand the mandatory architecture and why it's shaped this way   | `SPEC.md`                           |
| Add a tool to an existing server                                     | `docs/ADDING-A-TOOL.md`             |
| Add or understand presets                                            | `docs/ADDING-A-PRESET.md`           |
| Wire up auth, tenancy, and credentials                               | `docs/AUTHENTICATION.md`            |
| Understand every security control this scaffold ships with           | `docs/SECURITY.md`                  |
| Know what a host must support for write approvals to actually work   | `docs/HOST-INTEGRATION-CONTRACT.md` |
| Deploy to Docker / Azure Container Apps / locally                    | `docs/DEPLOYMENT.md`                |
| Avoid known footguns                                                 | `docs/KNOWN-GOTCHAS.md`             |
| Run the full checklist from scaffold to production                   | `DEVELOPMENT-CHECKLIST.md`          |
| Change the scaffold itself (not a server built from it)              | `CONTRIBUTING.md`                   |
| See what real-world MCP repos this scaffold's decisions are based on | `MCP-SCAFFOLD-REFERENCE.md`         |

## Working in this repo with Claude Code

This repo ships its own Claude Code operating layer, not just docs a human has to remember to
open:

- `CLAUDE.md` — the always-loaded cockpit placard: authority, required commands,
  non-negotiables, a task-to-doc map.
- `.claude/skills/nucleus-mcp-builder/` — a Skill that routes "add a tool" / "add a vendor" /
  "review this server" requests to the right doc instead of requiring the whole spec read
  every time.
- `.claude/agents/mcp-security-reviewer.md` and `mcp-protocol-reviewer.md` — narrow review
  agents scoped to exactly the concerns in `docs/SECURITY.md` and the MCP protocol
  respectively. Dispatch them before merging any change to `src/auth/`, `src/safety/`,
  `src/tools/`, or `src/server/`.

## Quickstart

```bash
cp .env.example .env      # set MOCKVENDOR_API_KEY to any value for the demo
npm ci
npm run dev                # runs the example server over stdio
```

Smoke-test it with [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```bash
npx @modelcontextprotocol/inspector npm run dev
```

You should see three demo tools (`mockvendor_search_open_high_priority_tickets`,
`mockvendor_list_tickets`, `mockvendor_close_ticket` + its `preview_` companion) backed by an
in-memory fake vendor (`examples/vendor/mock-vendor-client.ts`) — this is what
`docs/ADDING-A-TOOL.md` and `DEVELOPMENT-CHECKLIST.md` walk you through replacing with your
real vendor integration.

```bash
npm run verify   # typecheck + lint + test (with coverage) + build + catalogue generation
```

## What's in here

```
src/
  auth/            AuthenticatedPrincipal, TenantResolver, CredentialProvider, AuthorizationPolicy
  tools/            tool definition contract (defineTool), ToolContext, risk levels
  safety/           dry-run + operation tokens + human approval + redaction + rate limiting
  vendor/           VendorClient interface, controlled errors, bounded pagination, shared HTTP client
  observability/    structured logging, audit log, correlation IDs, metrics
  server/           tool registry, presets, stdio/HTTP transports, the composition root
  config/           env schema + fail-fast loader
  index.ts          demo entrypoint — swap examples/ for your real tools
examples/          working read tool, write tool, paginated tool, prompt, mock vendor
tests/             contract, security, tenant-isolation, tool unit tests, integration
docs/              task-specific how-tos (see table above)
deploy/            Docker, Azure Container Apps, local — reference deployment targets
scripts/           tool-catalogue / permission-manifest generation
```

Nearly everything here is framework code shared by every server cloned from this template.
`src/vendor/` and the tools you add under (a real server's) `src/tools/read/` and
`src/tools/write/` are the ~20% that's genuinely yours per project — see SPEC.md §3.

## Why this architecture (the short version)

- **One template, many vendors.** A competent engineer, with no prior scaffold knowledge,
  should get from a documented REST API + sandbox credentials to a working read-only server
  with tests passing in under a day. If it takes three, that's a scaffold bug — see SPEC.md §1.
- **Tenant identity is never trusted from model input.** A `tenantId` argument in a tool call
  is a hint, not an authorization — resolution happens against the authenticated principal.
- **Writes are a different lifecycle from reads**, not a flag bolted onto the same one.
  `medium` risk requires a dry run and a digest-bound single-use operation token; `high` risk
  (deletes, by definition) additionally requires a distinct human approver. The platform
  enforces the floor per risk tier — a tool can request stricter, never weaker.
- **Every tool response is minimized to its declared schema.** Whatever the vendor API
  actually returns, only the fields your `outputSchema` declares leave the tool — structurally,
  via `zod`'s parse-strips-unknown-keys behavior, not by developer discipline.
- **Presets before discovery.** Explicit, named tool bundles (`MCP_PRESETS=service-desk`) are
  the v1 tool-surface-scoping mechanism — simpler than full search-based dynamic discovery,
  and derived from each tool's own declaration rather than a second hand-maintained list.

Full reasoning for every one of these: `SPEC.md`.

## Toolchain & dependency baseline

**Language/runtime: TypeScript on Node.js 22+ (LTS, 22.12.0 or later — see `.nvmrc`).** This is the mainstream choice for MCP
servers today — the official TypeScript SDK is the most mature, the type system pays for
itself directly in this scaffold's schema-driven design (a tool's `inputSchema`/`outputSchema`
_are_ its TypeScript types via `z.infer`), and it's what most MCP tooling (Inspector, the
registry, most reference servers) assumes first. Python is the better call if your team's
domain is data/ML-adjacent and Python is already the house language; C#/.NET if you're
Azure/Microsoft-ecosystem-first end to end. This scaffold doesn't hedge across languages — pick
one and get the full benefit of a single well-typed contract, rather than a lowest-common-
denominator design that works passably in three languages.

| Concern           | Choice                          | Why                                                                                                                                                                                                                     |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema validation | `zod`                           | The MCP TypeScript SDK's native schema story; `z.infer` gives you types for free from the same declaration that drives runtime validation — one source of truth, not two to keep in sync.                               |
| Logging           | `pino`                          | Structured JSON by default, fast, straightforward `formatters`/`mixin` hooks — exactly what's needed for the redaction and correlation-ID wiring in `src/observability/`.                                               |
| HTTP transport    | `express`                       | Minimal, well-understood, and all this scaffold needs it for is a few health routes plus mounting the MCP SDK's own `StreamableHTTPServerTransport` — not a case for a heavier framework.                               |
| Test runner       | `vitest`                        | Fast, native ESM/TypeScript support without a separate ts-jest config layer, Jest-compatible API so it's not a new mental model.                                                                                        |
| Lint/format       | ESLint (flat config) + Prettier | `eslint.config.js` in this repo also encodes two safety rules as lint errors, not just style: no bare `fetch()` (bypasses the shared timeout/retry/circuit-breaker client) and no `console.*` (bypasses log redaction). |
| CI                | GitHub Actions                  | `.github/workflows/ci.yml` — typecheck, lint, format check, test with coverage, build, catalogue generation, dependency audit, Docker build. Adapt the YAML to your CI system; the _stages_ are what matter.            |

None of these choices are load-bearing for the architecture — swap `express` for `fastify`,
`pino` for `winston`, if your organization has a strong existing preference. What _is_
load-bearing: schema-driven tool definitions, structured logging with automatic redaction, and
routing every vendor call through one shared HTTP client. Keep those properties whatever
libraries you pick.

## License

Add your organization's license here before treating this as a template repo others clone.
