# Authentication, authorization, and tenant resolution

Four interfaces (SPEC.md §6), implemented once per deployment context, used by every tool.
Get comfortable with the distinction between them before touching this code — the whole
safety model rests on not conflating them:

| Interface                | Answers                                                | File                                  |
| ------------------------ | ------------------------------------------------------ | ------------------------------------- |
| `AuthenticatedPrincipal` | Who is calling?                                        | `src/auth/authenticated-principal.ts` |
| `TenantResolver`         | Which customer's data may they touch _this call_?      | `src/auth/tenant-resolver.ts`         |
| `CredentialProvider`     | What vendor API credentials do we use for that tenant? | `src/auth/credential-provider.ts`     |
| `AuthorizationPolicy`    | Are they allowed to do _this specific thing_?          | `src/auth/authorization-policy.ts`    |

## The one rule that matters most

**A `tenantId` the model passes as a tool argument is a hint, not a grant.** Every read/write
tool's execute path resolves the tenant via `TenantResolver.resolve(principal, requestedTenant)`
— the resolver decides whether `requestedTenant` is honored, ignored, or rejected. A tool's
`execute()` function never receives an unvalidated tenant string and treats it as
authoritative. If you're writing a new `TenantResolver` and find yourself just returning
`{ tenantId: requestedTenant }` unchecked, stop — that's the exact hole SPEC.md §2 principle 1
exists to close.

## AUTH_MODE

Set via `.env` / deployment config, validated at startup (`src/config/schema.ts`):

### `none` — local dev only

Single fixed principal, no credential check. The config schema refuses to start with
`TRANSPORT=http` in this mode — it is unreachable over a network by construction, not just by
convention.

### `api-key` — simple deployments

Static bearer tokens via `API_KEYS=key:subjectId:organizationId:role1|role2,...`
(`src/auth/http-authenticator.ts`, `ApiKeyAuthenticator`). Good enough for an internal server
with a small, known set of callers. Not a substitute for real OAuth in a client-facing
multi-tenant product — there's no token expiry, no revocation beyond editing the env var and
redeploying, and the key material itself sits in an env var (fine for a handful of internal
callers; not fine at real multi-tenant scale — see `CredentialProvider` below for where real
secret material belongs instead).

### `entra` — OAuth 2.1 / Microsoft Entra ID

**Not implemented in this template.** `EntraAuthenticator` is an explicit, loud stub that
refuses to authenticate anything (`src/auth/http-authenticator.ts`). This is deliberate: a
fake-but-plausible JWT validator is more dangerous than one that visibly refuses to run,
because it looks secure without being secure.

To make this real:

1. Register an app in Entra ID; decide SingleTenant vs MultiTenant depending on whether this
   server serves one customer's tenant or many (see `MCP-SCAFFOLD-REFERENCE.md` for real
   examples worth reading before writing your own — Wyre's `entra-app-registration.md`,
   InditexTech's `mcp-teams-server` SingleTenant/MultiTenant split).
2. Fetch and cache the tenant's JWKS (`https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys`).
3. On each request, verify: signature against the cached JWKS, `exp`/`nbf`, `iss` matches the
   expected tenant issuer, `aud` matches this server's registered app ID.
4. Map verified claims (`oid`, `roles`, `tid`, `preferred_username`) onto
   `AuthenticatedPrincipal` — `subjectId` from `oid`, `organizationId` from `tid`.
5. Feed the resolved `tid` (or a claim you trust) into your `TenantResolver` so tenant
   resolution is anchored to the token, not a request header a client could set to anything.

A good library choice for step 2–3 is `jose` (actively maintained, supports remote JWKS with
caching out of the box) — this template doesn't pin it because "entra" isn't implemented, but
it's the natural next dependency to add alongside a real `EntraAuthenticator`.

## Credentials are never a client-supplied header

The gateway pattern of accepting raw vendor API keys as per-request headers
(`X-Vendor-Api-Key`) shows up in some MCP servers in the wild as a multi-tenant routing
mechanism — see `MCP-SCAFFOLD-REFERENCE.md`, "Gateway mode for trusted tenant/identity
assertions." That pattern is legitimate for passing a _trusted, already-authenticated tenant
identifier_ through a gateway. It is **not** how vendor credentials should reach this server:
vendor secrets are always resolved server-side through `CredentialProvider`, never accepted as
long-lived plaintext from a client request. `EnvCredentialProvider`
(`src/auth/credential-provider.ts`) is a dev-only stand-in — swap it for Key Vault / Secrets
Manager / Vault in any real deployment; the interface doesn't change.

`CachingCredentialProvider` wraps any provider with a short-lived, strictly tenant-scoped
cache — the cache key always includes `tenantId`, so there's no code path where tenant A's
cached credentials leak to a concurrent request for tenant B. See
`tests/tenant-isolation/tenant-isolation.test.ts` for the test that would catch a regression here.

## Authorization

`RoleBasedAuthorizationPolicy` (`src/auth/authorization-policy.ts`) is the shipped default: a
static `role -> permissions` table plus an extra role gate for `risk: "high"` calls. Fine for
a deployment with a handful of roles defined in code. Swap for a real policy engine (OPA,
Cedar, a database-backed RBAC table) once role/permission mappings need to change without a
redeploy — the `AuthorizationPolicy` interface doesn't change either way.

Every tool declares its required permission as a structured `PermissionRequirement`
(`allOf` / `anyOf`) — see `docs/ADDING-A-TOOL.md` §5. This is what the authorization check
evaluates; there's no separate "which tools can this role see" list to keep in sync.
