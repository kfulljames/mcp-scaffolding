# Security

This is the "what and why" for every security control this scaffold ships with. If you're
deciding whether to skip one for your server, read the reasoning here first — most of these
exist because of an incident pattern observed in real MCP servers (see
`MCP-SCAFFOLD-REFERENCE.md`), not out of caution for its own sake.

## Input validation and sanitization

**Every tool input is validated by its `inputSchema` before `execute()` ever runs.**
`defineTool()` requires `inputSchema` to be a `z.object({...})` (`src/tools/tool-definition.ts`)
and the server parses every call through it (`src/server/create-server.ts`). Malformed input
never reaches your business logic as a runtime surprise — it's rejected as a structured
`INVALID_INPUT` error before your code sees it. Add real constraints (`.min()`, `.max()`,
`.email()`, enums over free strings) — a schema that's just `z.object({ id: z.string() })` for
everything validates nothing.

Separately, `src/safety/input-sanitizer.ts` strips control characters (including forged
newlines) from strings before they're logged — this is a **log-injection** defense, not a
content filter. It does not, and should not, try to detect or strip "prompt injection"
content — see the next section for why that's the wrong layer.

## Prompt injection: architecture, not filtering

Hostile content lives in ticket descriptions, filenames, vendor error messages — anywhere
untrusted external data flows through a tool response back to the model. This scaffold's
defense is structural: every tool response is minimized to its `outputSchema`
(`src/tools/tool-definition.ts`, `src/server/create-server.ts`) and returned as MCP
`structuredContent`/`content` — it is data in a typed field, never concatenated into a system
prompt or instruction context. There is nothing to "clean," because nothing here is ever
interpreted as an instruction in the first place. `tests/security/prompt-injection.test.ts`
asserts hostile content survives round-trip **unchanged** — a test that expected the content
to be modified would be testing the wrong thing.

## Authentication and authorization

Four separate interfaces, on purpose — see `docs/AUTHENTICATION.md` for the full picture:
`AuthenticatedPrincipal` (who), `TenantResolver` (which tenant, never trusting a model-supplied
tenant argument), `CredentialProvider` (vendor secrets, resolved server-side), and
`AuthorizationPolicy` (can this principal do this specific thing, at this risk level).
`AUTH_MODE=none` refuses to serve over HTTP (`src/config/schema.ts`) — there is no
accidentally-unauthenticated network deployment.

## Least privilege for tools and resources

- Every tool declares the narrowest `permissions` it actually needs (`allOf`/`anyOf` —
  `src/auth/authorization-policy.ts`). There's no ambient "the caller is authenticated, so
  everything's fine" path.
- `READ_ONLY=true` removes every write tool from the advertised MCP tool surface entirely
  (`ToolRegistry.filterReadOnly`) — not a runtime check that a determined bug could route
  around, an absence. Ship every new server `READ_ONLY=true` by default and prove reads work
  in production before ever flipping it.
- Presets (`docs/ADDING-A-PRESET.md`) let a deployment expose only the tool bundle a given
  audience needs — an agent-facing deployment doesn't need `admin` tools loaded at all.
- `outputSchema` minimization (see above) is least-privilege applied to _data_, not just
  actions — a tool that only needs `{id, summary, priority}` never leaks the other forty
  fields the vendor API happened to return.

## Secrets management

- Vendor credentials: never hardcoded, never a client-supplied header. Resolved server-side
  per tenant through `CredentialProvider` (`src/auth/credential-provider.ts`) — swap
  `EnvCredentialProvider` (dev-only) for Key Vault/Secrets Manager/Vault in any real
  deployment. `.env` files are `.gitignore`d; `.env.example` documents shape, never real values.
- API keys for `AUTH_MODE=api-key`: fine as an env var for a handful of internal callers
  (`docs/AUTHENTICATION.md` explains the tradeoff); move to the same secret store as vendor
  credentials once the caller list grows or the deployment is client-facing.
- Logs and audit entries: `src/safety/response-redactor.ts`'s `redact()` recursively strips
  any field whose _key_ looks secret-shaped (`password`, `token`, `apiKey`, `secret`,
  `authorization`, `credential`, ...), applied uniformly by the structured logger
  (`src/observability/logger.ts`) — a developer logging `{ input }` verbatim during debugging
  still can't leak a credential, because the redaction happens at the log-formatter layer, not
  by developer discipline at each call site.

## Rate limiting and abuse prevention

`TokenBucketRateLimiter` (`src/safety/rate-limiter.ts`) enforces a per-authenticated-principal
token bucket at the HTTP transport boundary (`RATE_LIMIT_PER_MINUTE`, default 120/min),
applied **after** authentication so an unauthenticated flood is rejected by the 401 path
first rather than consuming shared rate-limit budget. A limit-exceeded response is `429` with
a `Retry-After` header, not a silent drop. This is per-principal, not global — a global limit
lets one noisy caller starve every other tenant, which defeats the point.

Separately, `VendorHttpClient` (`src/vendor/http-client.ts`) implements a circuit breaker
around outbound vendor calls — if a vendor is failing repeatedly, the server stops hammering
it and fails fast for a cool-down window instead. This protects the _vendor_ from this
server's own retry behavior amplifying an outage; the rate limiter protects this _server_ from
its callers. Both are in-memory/single-instance — see `docs/KNOWN-GOTCHAS.md` for what changes
in a horizontally-scaled deployment.

## Logging without leaking sensitive data

- Structured JSON (`pino`), every log line — grep-able and machine-parseable, never
  string-concatenated (SPEC.md §9).
- Every log object passes through `redact()` before serialization
  (`src/observability/logger.ts`'s `formatters.log`) — automatic, not a per-call-site habit.
- The audit log (`src/observability/audit-log.ts`) is a narrower, separate stream: who, what
  tool, what tenant, what risk level, what outcome. It deliberately excludes raw request/
  response bodies — it's an activity trail for "who did what," not a debug log. Cross-reference
  its `requestId` against the (redacted) application log for deeper investigation.
- Correlation IDs (`src/observability/correlation.ts`) thread through every log line for one
  request via `AsyncLocalStorage`, without every function signature needing to pass them
  explicitly — a support investigation can `grep` one `correlationId` and see the whole call.

## Write safety (the biggest differentiator across MCP servers reviewed)

Covered in full in SPEC.md §7 and `docs/ADDING-A-TOOL.md`'s wire-protocol section. The
one-sentence version: every write requires a dry run first, `medium`+ risk requires a
digest-bound single-use operation token, `high` risk additionally requires a distinct human
approver — and the platform enforces the _floor_ for each tier (`src/tools/risk-level.ts`), so
a tool author can request stricter controls but never opt out of the baseline. This is, per
the pattern research behind this scaffold, the single biggest safety gap in MCP servers built
without it — see `MCP-SCAFFOLD-REFERENCE.md`, "Confirm/dry-run gates on every write operation."

## Dependency and supply-chain hygiene

- `npm audit --audit-level=high` runs in CI (`.github/workflows/ci.yml`) — high/critical
  vulnerabilities fail the build; moderate-and-below is a judgment call, not an automatic gate.
- Check the license of anything copied from a public MCP repo before treating it as usable —
  "public on GitHub" is not "MIT licensed." See `MCP-SCAFFOLD-REFERENCE.md`'s cautionary
  example (a proprietary-licensed repo that looks identical to an open one at a glance).
- Pin dependency versions in `package-lock.json` (committed) and let Dependabot/Renovate (or
  equivalent) open update PRs rather than floating on `^` ranges unreviewed in CI.
