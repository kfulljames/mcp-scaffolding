# Deployment

## Transport modes

`TRANSPORT` is explicit config (`src/config/schema.ts`), never inferred from whether `PORT`
happens to be set — see `docs/KNOWN-GOTCHAS.md` for the incident this avoids.

```bash
# Local dev / editor integration, single tenant, read-only
TRANSPORT=stdio
READ_ONLY=true
MCP_PRESETS=service-desk

# Production, HTTP, multi-tenant
TRANSPORT=http
PORT=3000
AUTH_MODE=api-key   # or entra, once implemented — see docs/AUTHENTICATION.md
```

`stdio` is for local processes (Claude Desktop, an IDE extension, a CLI) with a single
implicit caller. `http` (stateless streamable HTTP, `src/server/transports.ts`) is for
anything remote/shared/multi-tenant. See SPEC.md §11.

## Health endpoints — three, not one

| Endpoint             | Checks                                     | Depends on vendor? |
| -------------------- | ------------------------------------------ | ------------------ |
| `GET /health/live`   | Process is up                              | No                 |
| `GET /health/ready`  | Config loaded, dependencies constructible  | No                 |
| `GET /health/vendor` | Vendor connectivity (sanitized diagnostic) | Yes, deliberately  |

The live/ready split exists so a transient vendor outage doesn't get your otherwise-healthy
container killed and endlessly restarted by an orchestrator that only has one health check to
point at (SPEC.md §9). Point your orchestrator's liveness/readiness probes at `/health/live`
and `/health/ready` respectively — never at `/health/vendor`. `/health/vendor` ships as a
`501 not_configured` stub in this template because a meaningful vendor health check is usually
tenant-scoped (which credentials do you check with?) — wire it to something real once you know
whether your vendor exposes a tenant-agnostic status endpoint, or delete the route if it can
only ever be tenant-scoped.

## Docker

```bash
docker build -t my-mcp-server .
docker run --rm -p 3000:3000 --env-file .env my-mcp-server
```

See `deploy/docker/` for the reference `docker-compose.yml`. The `Dockerfile` at repo root is
multi-stage (build stage with devDependencies, slim runtime stage without them), runs as a
non-root user, and does not bake in any `.env` file — secrets are supplied at run time
(`--env-file`, orchestrator secret injection, or a mounted Key Vault CSI driver), never built
into the image layer.

## Azure Container Apps

See `deploy/azure-container-apps/` for a Bicep template and deployment notes. Key points not
obvious from the template itself:

- Use a managed identity + Key Vault reference for `CredentialProvider`'s backing store, not
  Container Apps' plain secret store, once you're past local dev — plain secrets there are
  still visible to anyone with `Microsoft.App/*/read` on the resource.
- Scale-to-zero is fine for `stdio`-adjacent low-traffic internal tools; for anything serving
  concurrent multi-tenant HTTP traffic, set a minimum replica count so cold start isn't in the
  critical path of every first request after idle.
- Liveness/readiness probes map directly to `/health/live` and `/health/ready` above.

## Local (non-Docker)

```bash
cp .env.example .env   # fill in real values
npm ci
npm run build
npm start
```

`npm run dev` (via `tsx watch`) is the faster inner loop for iteration — it does not require a
build step first.

## Before every deploy

Run `npm run verify` (typecheck + lint + test + build + catalogue generation) locally or let
CI (`.github/workflows/ci.yml`) gate the merge. Then walk `DEVELOPMENT-CHECKLIST.md`'s
"Deployment" section — it's the definition-of-done from SPEC.md §13 turned into a checklist.

## Rollback

Container images are immutable and tagged by commit SHA (wire this into your CI's build step
once you have a real registry) — rolling back is redeploying the previous tag, not reverting
code and rebuilding under time pressure. Keep at least the last few known-good tags retained in
your registry's retention policy for exactly this reason.
