# Known gotchas

A running list of things that will bite you if you don't know them going in. Add to this file
the moment you hit something new and burn time on it — that's the whole value of this doc
(see `MCP-SCAFFOLD-REFERENCE.md`, "Document known gotchas as you hit them").

## The pinned Node version in `.nvmrc` must actually satisfy every devDependency's engine range

`.nvmrc` (currently `22.12.0`) is what CI, `actions/setup-node`, and a local `nvm use` all key
off of — but nothing enforces that it's new enough for whatever's in `node_modules`. This bit
a real CI run: `.nvmrc` was `20.11.0`, which satisfied every _runtime_ requirement (this
scaffold's own `engines.node`, at the time also `>=20.11.0`), but vitest 4's `rolldown`
dependency requires `node:util`'s `styleText` export (added in Node 20.12.0) and otherwise
declares `^20.19.0 || >=22.12.0` — so `npm run test:coverage` crashed at startup in CI with a
`SyntaxError` on module load, despite `npm ci`, typecheck, and lint all succeeding first. It
worked in local development because the local Node version happened to already be newer than
`.nvmrc` specified — `.nvmrc` alone was never actually being validated against.

Symptom to recognize: a `Startup Error` / `SyntaxError: The requested module 'node:util' does
not provide an export named 'X'` from deep inside a dependency (`rolldown`, `vite`, etc.),
immediately when a script starts, not a real test/type/lint failure. Fix is to bump `.nvmrc`
(and `package.json`'s `engines.node`, and the `Dockerfile` base image) to whatever the
_strictest_ devDependency actually requires — check `npm ci`'s `EBADENGINE` warnings, which
name the exact package and required range; don't just bump `.nvmrc` by one patch version and
hope. After any major devDependency upgrade (especially vitest/vite), re-run `npm ci` on a
clean `node_modules` and read the `EBADENGINE` warnings before assuming the pinned Node version
still suffices.

## `npm audit` shows a moderate `@hono/node-server` vulnerability that isn't actually fixable here

`@modelcontextprotocol/sdk` pins `@hono/node-server@^1.19.9`, which is affected by
[GHSA-frvp-7c67-39w9](https://github.com/advisories/GHSA-frvp-7c67-39w9) (a Windows-only path
traversal in Hono's `serve-static` feature). This is not resolvable by bumping our own
dependencies — even the latest published SDK version still requires that range. Tracked,
accepted risk: `--audit-level=high` (what CI gates on) doesn't fail on it since it's
`moderate`, and this scaffold's own HTTP transport (`src/server/transports.ts`) never uses
Hono's static-file-serving feature at all, so the vulnerable code path isn't reachable through
this scaffold's usage regardless. Re-check `npm audit` after bumping `@modelcontextprotocol/sdk`
in the future — it may resolve on its own once upstream updates its `@hono/node-server` pin.

## `npm run test:coverage` is what CI actually gates on, not `npm test`

`npm test` (plain `vitest run`, no coverage) is the fast inner-loop command and is what you'll
reach for locally. CI's "Typecheck, lint, test, build" job runs `npm run test:coverage`
instead, which additionally enforces the coverage thresholds in `vitest.config.ts` (80%
statements/functions/lines, 75% branches). A change that passes `npm test` locally can still
fail CI if it drops coverage — run `npm run verify` (which now runs `test:coverage`, not plain
`test`) before pushing, not just `npm test`. This bit the very first CI run against
this scaffold: 58 tests passed locally, but coverage sat at ~46% because entire files
(`src/auth/http-authenticator.ts`, `src/safety/rate-limiter.ts`, `src/server/transports.ts`,
the bulk of `src/server/create-server.ts`, `src/vendor/http-client.ts`) had zero test coverage
until `tests/integration/mcp-protocol.test.ts` (a real MCP `Client` talking to `buildMcpServer()`
over `InMemoryTransport` — see `@modelcontextprotocol/sdk/inMemory.js`) and
`tests/integration/http-transport.test.ts` (a real listening HTTP server) were added
specifically to close those gaps.

## In-memory safety stores don't survive a restart or a second instance

`InMemoryOperationTokenStore`, `InMemoryApprovalService`, and `TokenBucketRateLimiter` are all
correct for exactly one thing: a single server process. The moment you run more than one
instance (horizontal scaling, blue/green, even two `npm run dev` processes hitting the same
client) — a token issued by instance A looks perfectly valid to instance A and completely
unknown to instance B. Symptoms: intermittent "operation token is invalid, expired, or already
used" errors that seem to happen at random, or rate limits that reset unexpectedly. Fix:
replace these three with Redis-backed (or similar shared-store) implementations behind the
same interfaces before running more than one instance — the interfaces
(`OperationTokenStore`, `ApprovalService`, `RateLimiter`) don't change.

## `preview()` must be side-effect-free

`src/safety/write-executor.ts` re-runs your tool's `preview()` at execute time to re-derive the
digest and check it against the operation token. If `preview()` does anything beyond reading
state and describing a proposed change, that side effect now happens twice per write — once
during the actual dry-run call, once again silently during every real execute. This is easy to
get wrong if `preview()` and `execute()` share a helper that isn't as pure as it looks; test
this explicitly for any non-trivial write tool.

## `TRANSPORT` is explicit for a reason — don't reintroduce PORT-inference

An earlier pattern seen in the wild (see `MCP-SCAFFOLD-REFERENCE.md`) infers HTTP vs stdio
from whether `PORT` is set. It's tempting to "simplify" config by removing `TRANSPORT` and
doing the same here. Don't — an accidentally-set `PORT` in a stdio deployment's environment
(common in containerized dev setups that set `PORT` globally) silently flips transport mode.
`src/config/schema.ts` requires `TRANSPORT` explicitly and validates it against `AUTH_MODE`
at startup instead.

## `inputSchema`/`outputSchema` must be `z.object({...})`, not any other ZodType

`defineTool()` throws `InvalidToolDefinitionError` if either isn't a `ZodObject` instance
(`src/tools/tool-definition.ts`). This isn't arbitrary — the server registration layer
(`src/server/create-server.ts`) needs `.shape` to hand raw field schemas to the MCP SDK. If
you're tempted to use `z.union([...])` or a bare `z.string()` at the top level for a tool's
input, wrap it: `z.object({ payload: z.union([...]) })`.

## `EnvCredentialProvider` and `NoAuthAuthenticator`/`ApiKeyAuthenticator` are dev conveniences

They ship so `npm run dev` and the test suite work without any external dependency. Neither is
a production credential/identity story — see `docs/AUTHENTICATION.md` for what to actually
wire up. It is very easy to ship a first internal pilot on `EnvCredentialProvider` because it
works fine at small scale, and then forget it's there. Grep for it before a client-facing launch.

## `EntraAuthenticator` throws on every call — that's intentional

If you enable `AUTH_MODE=entra` without implementing real token validation first, every
request will fail authentication with a clear error pointing back to this doc. That's the
point — see `src/auth/http-authenticator.ts`'s doc comment for why a stub that visibly fails
is safer than a stub that pretends to validate tokens.

## `npm run generate:catalogue` output is generated, not source

`generated/tool-catalogue.json`, `generated/permission-manifest.json`, and
`generated/presets.json` are git-ignored and regenerated by CI on every build. Don't hand-edit
them, and don't be surprised they're missing right after a fresh clone — run the script (or
`npm run verify`, which includes it) once.

## Rate limiting only applies over HTTP

`TokenBucketRateLimiter` is wired into `createHttpApp` (`src/server/transports.ts`) — a
`stdio` server has exactly one implicit local caller and no rate limiting is applied. If you
add an HTTP-adjacent surface later (a webhook receiver, an admin API) that doesn't go through
`createHttpApp`, it needs its own rate limiting — this one doesn't cover it for free.

## ESLint bans `fetch()` and `console.*` on purpose

Both are intentional friction, not defaults left over from a template generator:

- `fetch()` outside `VendorHttpClient` skips the shared timeout/retry/circuit-breaker
  behavior SPEC.md §9 requires — see `eslint.config.js`'s `no-restricted-syntax` rule.
- `console.*` skips the redacting structured logger — a `console.log(credentials)` left in
  during debugging bypasses every log-redaction control in `docs/SECURITY.md`.

If a lint error here feels like it's in your way, the fix is almost always "route this through
`VendorHttpClient`/the logger," not disabling the rule.
