# Development checklist

Run through this for every new MCP server built from this template. It's the FDE workflow
from SPEC.md §12 and the definition-of-done from SPEC.md §13, merged into one linear
checklist — copy this file into a new server repo's issue tracker or PR description template
and check items off as you go.

## 1. Scaffold

- [ ] Clone this template; rename package, `SERVER_NAME`, repo.
- [ ] Delete `examples/` and the demo wiring in `src/index.ts` once you have real tools — or
      keep them alongside as a working reference while you build; just don't ship them.
- [ ] Decide your naming convention (vendor-prefixed, per this template's default, or
      unprefixed per raw SPEC.md §4) and write it down in your own README — see
      `docs/ADDING-A-TOOL.md` §4.

## 2. Vendor integration

- [ ] Implement `VendorClient` for the target API (`src/vendor/client.ts` — extend it, don't
      widen it into a generic interface every vendor squeezes into; see SPEC.md §6).
- [ ] Route every outbound call through `VendorHttpClient` (`src/vendor/http-client.ts`) for
      timeout/retry/circuit-breaking — never call `fetch` directly (ESLint enforces this).
- [ ] Map vendor error responses onto `src/vendor/errors.ts` classes.
- [ ] Confirm `healthCheck()` is meaningful for `/health/vendor`, or explicitly decide it isn't
      tenant-agnostic and adjust/remove that route — see `docs/DEPLOYMENT.md`.

## 3. Authentication & tenancy

- [ ] Choose `AUTH_MODE` for this deployment (`none` for local-only, `api-key` for simple
      internal, `entra` — after implementing it for real, see `docs/AUTHENTICATION.md`).
- [ ] Implement `TenantResolver` for your deployment context (single-tenant internal always
      resolves to one tenant; multi-tenant validates the caller against real authorization,
      never trusting a model-supplied tenant argument as-is).
- [ ] Implement a real `CredentialProvider` backed by your actual secret store — confirm
      `EnvCredentialProvider` isn't still wired in for anything beyond local dev.
- [ ] Define your role → permission table in `AuthorizationPolicy` (or swap in a real policy
      engine if you need more than static roles).

## 4. Tools

- [ ] Every tool is task-shaped, not a raw endpoint wrapper (`docs/ADDING-A-TOOL.md` §1).
- [ ] Every tool has an owner and a description that states what it does **and does not** do.
- [ ] Every tool declares access mode, permissions (`allOf`/`anyOf`), and risk level.
- [ ] Every write tool implements `preview()` and declares an idempotency strategy.
- [ ] Every tool is assigned to at least one preset.
- [ ] Read tools built and validated in production use **before** write tools are added
      (SPEC.md §12) — don't build the write half of a domain speculatively.
- [ ] Contract tests: malformed input rejected by schema, output matches `outputSchema`
      exactly, errors are controlled (never a raw vendor stack trace).
- [ ] Write tools additionally have security tests: absent under `READ_ONLY=true`, rejects
      execute without dry run, rejects reused/expired/mismatched tokens, `high` risk rejects
      without human approval.
- [ ] At least one usage example per tool (or reuse `examples/` as the template).

## 5. Safety verification

- [ ] `READ_ONLY=true` is verified — by test, not by eyeballing — to remove every write tool
      from the advertised MCP tool surface.
- [ ] Tenant-isolation tests pass: tenant A cannot reach tenant B's data via any path,
      including a model-supplied tenant override; cached credentials don't bleed across
      concurrent tenant requests.
- [ ] Prompt-injection tests pass: hostile content in vendor data round-trips as inert data.
- [ ] Secrets are redacted in both logs and tool responses — spot check by grepping a captured
      log line for a known test credential value.
- [ ] Rate limiting is configured (`RATE_LIMIT_PER_MINUTE`) appropriately for expected traffic.

## 6. Observability

- [ ] Structured (JSON) logging confirmed in the deployment target's actual log format —
      `LOG_FORMAT=pretty` must never reach a shipped container.
- [ ] Audit logging is enabled, tenant-labeled, and confirmed to exclude credentials/raw
      request-response bodies.
- [ ] Correlation IDs thread through a real end-to-end request — verify by grepping one
      `correlationId` across a multi-log-line call.
- [ ] `/health/live` and `/health/ready` both respond correctly; `/health/vendor` is either
      wired to something real or intentionally removed.

## 7. Generated artifacts

- [ ] Tool catalogue and permission manifest are generated (`npm run generate:catalogue`), not
      hand-written, and committed as build output where your deployment pipeline expects them.

## 8. CI

- [ ] `npm run verify` passes locally.
- [ ] CI (`.github/workflows/ci.yml` or your fork of it) is green: typecheck, lint, format
      check, test with coverage, build, catalogue generation, dependency audit, Docker build.

## 9. Deployment

- [ ] Deployment is reproducible from `deploy/` examples (Docker, Azure Container Apps, or
      your own target modeled on the same pattern).
- [ ] Secrets are never baked into the image — confirmed via a fresh `docker build` +
      `docker history` spot check, not just "I didn't add a COPY for .env."
- [ ] Health probes point at `/health/live` / `/health/ready`, never `/health/vendor`.
- [ ] Container image tagged by commit SHA, not `:latest`.
- [ ] First production traffic runs with `READ_ONLY=true` regardless of whether write tools
      exist yet — flip it only after reads are validated live.

## 10. Licensing & provenance

- [ ] Any code adapted from a public MCP repo has had its license checked — "public on
      GitHub" is not "usable license." See `MCP-SCAFFOLD-REFERENCE.md`'s scorecard and
      cautionary example.

## 11. Sign-off

- [ ] All items above checked.
- [ ] `SPEC.md` §13 definition-of-done reviewed directly (this checklist is a superset, but
      re-read the source once — checklists drift, the spec is truth).
