# Nucleus MCP Scaffold — SPEC.md

This is the non-negotiable architecture for every MCP server built at Nucleus, internal or client-facing. It exists so an FDE builds `search_agreements` for NinjaOne the same way they built `search_open_high_priority_tickets` for ConnectWise — same interfaces, same safety defaults, same test suite, no re-litigating architecture per project.

Companion documents:

- `MCP-SCAFFOLD-REFERENCE.md` — research memory (patterns observed in the wild, licensing notes). Read once, don't re-derive from it per project.
- `docs/ADDING-A-TOOL.md`, `docs/ADDING-A-PRESET.md`, `docs/AUTHENTICATION.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/KNOWN-GOTCHAS.md` — task-specific how-tos that point back here for the "why."

---

## 1. Objectives and non-goals

**Objectives**

- One template, many vendors. Cloning + renaming should get an FDE to a working read-only server against a new vendor API in under a day.
- The secure path is the only easy path. Unsafe behavior must require an explicit, reviewable override of scaffold defaults — not just be theoretically avoidable.
- Every server is auditable, testable, and deployable the same way, regardless of who built it.

**Acceptance test for the "under a day" objective.** Give a competent FDE, with no prior scaffold knowledge: a documented REST API, sandbox credentials, and the scaffold. Measure whether they can implement auth, build one search tool and one get tool, assign a preset, pass inherited tests, run locally, and produce a Docker image — in under a day. If it takes three, the scaffold is too abstract or the docs are insufficient, and that's a scaffold bug, not an FDE skill gap.

**Non-goals (v1)**

- Full dynamic tool discovery (search-based). Presets cover this need for now — see §5.
- Natural-language dispatch routing.
- Cross-server orchestration or a meta-server that talks to multiple vendor servers at once.
- A generic `custom_request` fallback. Not included in v1 at all — if introduced in v2, it will be opt-in and heavily restricted (see §15).

---

## 2. Architectural principles

1. **Tenant identity is never trusted from model input.** A `tenant_id` the model passes in a tool call is a hint, not an authorization. Resolution happens against the authenticated principal, not the argument.
2. **Every tool declares its own risk, not just its logic.** Access mode, permissions, and risk level are metadata on the tool definition, not something inferred from what the code happens to do.
3. **Vendor-specific code stays behind one interface.** `VendorClient` is the only place ConnectWise-isms (or NinjaOne-isms, or M365-isms) live. Everything else in the scaffold is vendor-agnostic.
4. **Writes are a different lifecycle from reads, not a flag on the same one.** See §7.
5. **Presets before discovery.** Ship with curated, explicit tool bundles. Discovery is a v2 layer on top of the same registry metadata — nothing gets redesigned to add it later.

---

## 3. Repository structure

```
nucleus-mcp-template/
├── src/
│   ├── server/
│   │   ├── create-server.ts
│   │   ├── transports.ts        # stdio + streamable HTTP
│   │   ├── tool-registry.ts
│   │   └── presets.ts
│   ├── auth/
│   │   ├── authenticated-principal.ts
│   │   ├── tenant-resolver.ts
│   │   ├── credential-provider.ts
│   │   └── authorization-policy.ts
│   ├── tools/
│   │   ├── tool-definition.ts
│   │   ├── tool-context.ts
│   │   ├── risk-level.ts
│   │   ├── read/
│   │   └── write/
│   ├── safety/
│   │   ├── approval-service.ts
│   │   ├── dry-run.ts
│   │   ├── operation-token.ts
│   │   ├── input-sanitizer.ts
│   │   └── response-redactor.ts
│   ├── vendor/
│   │   ├── client.ts            # VendorClient interface
│   │   ├── errors.ts
│   │   ├── pagination.ts
│   │   └── types.ts
│   ├── observability/
│   │   ├── audit-log.ts
│   │   ├── logger.ts
│   │   ├── metrics.ts
│   │   └── correlation.ts
│   ├── config/
│   │   ├── schema.ts
│   │   └── environment.ts
│   └── index.ts
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── security/
│   ├── tenant-isolation/
│   └── tools/
├── examples/
│   ├── read-tool.ts
│   ├── write-tool.ts
│   ├── paginated-tool.ts
│   └── workflow-prompt.ts
├── deploy/
│   ├── docker/
│   ├── azure-container-apps/
│   └── local/
├── docs/
│   ├── ADDING-A-TOOL.md
│   ├── ADDING-A-PRESET.md
│   ├── AUTHENTICATION.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   └── KNOWN-GOTCHAS.md
├── SPEC.md                       # this file
├── CONTRIBUTING.md
├── .env.example
├── Dockerfile
└── package.json
```

Only `src/vendor/` and `src/tools/{read,write}/` differ meaningfully between a ConnectWise server and a NinjaOne server. Everything under `src/server/`, `src/auth/`, `src/safety/`, `src/observability/` is supplied by versioned scaffold packages (§14), not reimplemented — and not copy-pasted — in vendor repositories. The tree above shows the full logical structure; in practice a vendor repo contains mostly `src/vendor/`, `src/tools/`, and `src/presets.ts`.

---

## 4. Tool definition contract

Every tool is declared through one function, not registered ad hoc. The declaration drives MCP registration, preset membership, permission calculation, read-only filtering, audit classification, documentation generation, and the automated security test suite — all from one source of truth.

```typescript
export const searchOpenHighPriorityTickets = defineTool({
  name: "search_open_high_priority_tickets",
  description:
    "Searches for open high-priority service tickets available to the authenticated tenant.",

  preset: ["service-desk"],

  access: {
    mode: "read",
    permissions: { allOf: ["tickets.read"] },
    risk: "low",
  },

  inputSchema: z.object({
    boardIds: z.array(z.number()).optional(),
    priorityIds: z.array(z.number()).optional(),
    limit: z.number().min(1).max(100).default(25),
  }),

  outputSchema: z.object({
    tickets: z.array(ticketSummarySchema),
    hasMore: z.boolean(),
  }),

  async execute(input, context) {
    const tickets = await context.vendor.tickets.search({
      tenant: context.tenant,
      ...input,
    });
    return minimizeTicketResponse(tickets); // never return raw vendor payload
  },
});
```

Rules:

- `outputSchema` is mandatory. If it doesn't validate, the tool fails closed, not open.
- `execute` never returns the raw vendor API response — always through a minimizer that strips fields the tool didn't declare in its schema. This is the response-size and data-minimization control, not an afterthought.
- A tool with no `preset` assigned doesn't ship. No orphan tools.

**Multiple permissions are a structured policy, not a bare array.** `permissions: ["tickets.read"]` is ambiguous once a tool needs two — does it mean all-of or any-of? Declare it explicitly:

```typescript
permissions: {
  allOf: ["tickets.read", "companies.read"];
}
// or, later:
permissions: {
  anyOf: [["tickets.admin"], ["tickets.read", "companies.read"]];
}
```

**`ToolContext` is a mandatory interface, not an implicit shape inferred from examples.** It's where tenant, principal, credentials, and audit wiring meet, and a tool author must never be able to construct or override it:

```typescript
interface ToolContext<TVendor extends VendorClient> {
  requestId: string;
  correlationId: string;
  principal: AuthenticatedPrincipal;
  tenant: ResolvedTenant;
  vendor: TVendor;
  authorization: AuthorizationDecision;
  audit: AuditLogger;
  signal: AbortSignal;
}
```

**Tool naming conventions:**

- Verb first, lowercase snake_case: `search_open_tickets`, `get_ticket`, `add_ticket_note`, `preview_close_ticket`.
- No vendor name in the tool name unless genuinely ambiguous (`search_open_tickets`, not `query_service_records` or `update_cw_ticket`).
- Names are stable after release — renaming a shipped tool is a breaking change (see §9, versioning).
- No synonym drift across tools in the same server (`get` vs `fetch` vs `retrieve` — pick one verb per action type and hold it).
- Descriptions state what the tool does **and does not** do (e.g., "read-only; does not include closed tickets").

---

## 5. Presets (v1 discovery mechanism)

Explicit, named bundles of tool names — an exact allow-list, never a fuzzy match:

```typescript
export const presets = {
  "service-desk": ["search_open_high_priority_tickets", "get_ticket", "add_ticket_note"],
  finance: ["search_agreements", "get_invoice"],
  admin: ["list_boards", "list_statuses"],
};
```

Launch modes:

```
MCP_PRESETS=service-desk npm start
MCP_PRESETS=service-desk,admin npm start
```

v2 note: a discovery/search tool reads the same registry metadata presets already declare. Nothing about the tool definition contract changes when that ships — see backlog §15.

---

## 6. Auth & tenant resolution

Four interfaces, implemented once per deployment context, reused by every tool.

**`AuthenticatedPrincipal`** — who is calling:

```typescript
interface AuthenticatedPrincipal {
  subjectId: string;
  email?: string;
  organizationId: string;
  roles: string[];
  claims: Record<string, unknown>;
}
```

**`TenantResolver`** — which customer/account this caller may act on. A model-supplied tenant argument is a _request_, not a grant:

```typescript
interface TenantResolver {
  resolve(
    principal: AuthenticatedPrincipal,
    requestedTenant?: string,
  ): Promise<ResolvedTenant>;
}
```

**`CredentialProvider`** — how vendor credentials are retrieved, abstracted so Key Vault / Secrets Manager / Vault / local dev creds / delegated OAuth all implement the same interface without touching a single tool:

```typescript
interface CredentialProvider {
  getCredentials(tenant: ResolvedTenant, vendor: string): Promise<VendorCredentials>;
}
```

**`AuthorizationPolicy`** — can this caller perform this action, for this tenant, at this risk level:

```typescript
interface AuthorizationPolicy {
  authorize(request: {
    principal: AuthenticatedPrincipal;
    tenant: ResolvedTenant;
    permission: string;
    risk: RiskLevel;
  }): Promise<AuthorizationDecision>;
}
```

Internal single-tenant deployments still implement all four — `TenantResolver` just always resolves to Nucleus's own tenant. This keeps the internal CW pilot and the future client-facing product on the identical code path; nothing gets rewritten when the pilot graduates to multi-tenant.

**`VendorClient` is a thin base, not one interface every vendor squeezes into.** A single generic interface across ConnectWise, NinjaOne, and M365 becomes either impossibly generic or effectively untyped. The base declares only what's universal; vendor-specific clients extend it or compose capability interfaces:

```typescript
interface VendorClient {
  readonly vendorId: string;
  healthCheck(): Promise<HealthStatus>;
}

interface ConnectWiseClient extends VendorClient {
  tickets: TicketService;
  agreements: AgreementService;
}

// or, for capabilities shared across vendors:
interface TicketProvider {
  searchTickets(...): Promise<...>;
  getTicket(...): Promise<...>;
}
```

---

## 7. Write safety lifecycle

A write tool is not a read tool with `confirm: true` bolted on. It declares an approval policy, and risk level determines what that policy requires:

| Risk level | `dryRunRequired` | `operationTokenRequired` | `humanApprovalRequired` |
| ---------- | ---------------- | ------------------------ | ----------------------- |
| `low`      | optional         | no                       | no                      |
| `medium`   | yes              | yes                      | no                      |
| `high`     | yes              | yes                      | yes                     |

```typescript
export const closeTicket = defineTool({
  name: "close_ticket",
  access: { mode: "write", permissions: { allOf: ["tickets.write"] }, risk: "medium" },
  approval: {
    dryRunRequired: true,
    humanApprovalRequired: false,
    operationTokenRequired: true,
  },
  async preview(input, context) {
    return {
      action: "Close ticket",
      target: input.ticketId,
      proposedChanges: { status: input.closedStatus, resolution: input.resolution },
    };
  },
  async execute(input, context) {
    return context.vendor.tickets.close(input);
  },
});
```

`preview()` is mandatory on every write tool — it's what the dry-run flow calls before `execute()` is ever reachable. An operation token is single-use and short-lived; it proves a preview was shown before the mutating call happened, and it cannot be replayed.

Deletes are `risk: "high"` by definition. No tool ships with a delete operation at `low` or `medium`.

**Risk baseline is framework-enforced, not author-trusted.** The §7 table is the platform floor, derived automatically from `risk`. A tool may request _stricter_ controls than its risk level requires, but never weaker ones — declaring `risk: "medium"` with `dryRunRequired: false` fails at server startup, not silently at runtime.

**Human approval is bound to a digest of the previewed action, not a boolean.** Without this, `preview()` can describe one payload while `execute()` performs another. Requirements:

- Approval is tied to the authenticated human principal — never a model-generated boolean.
- The operation digest is computed as `hash(tool + tenant + normalized input + proposed changes)`.
- The approval token and operation token are both bound to that digest — changing the payload after approval invalidates it.
- Approval expires (short TTL) and the approver identity is recorded in the audit log.
- Separation of duties (approver ≠ requester) may be required per tool, configurable.

**Idempotency is a framework capability, not something each vendor implementation improvises.** Every write tool declares its strategy:

```typescript
idempotency: { strategy: "operation-token", ttlSeconds: 900 }
```

Automatic retry of a write is only permitted when idempotency is guaranteed by this mechanism — never a bare retry of an unsafe mutation.

---

## 8. Response handling

- Every tool response is minimized to its declared `outputSchema` — never the raw vendor payload passed through.
- Maximum response size is enforced at the framework level, not per-tool discipline.
- Credentials, tokens, and secrets are redacted in both responses and logs by a shared `response-redactor` — not something each tool author remembers to do.
- Pagination is bounded (see `vendor/pagination.ts`) — no tool can be asked for an unbounded result set.

---

## 9. Observability

- **Structured audit log**, tenant-labeled, on every tool call: who, what tool, what tenant, what risk level, what the outcome was. Never contains credentials or raw request/response bodies.
- **Correlation IDs** threaded through every request so a support investigation can trace one call end to end.
- **Health and readiness are separate endpoints, not one.** `/health/live` (process is alive), `/health/ready` (config loaded, dependencies usable), and optionally `/health/vendor` (vendor connectivity diagnostic — sanitized, no credential detail leaked). A transient ConnectWise outage should not cause a container orchestrator to kill and endlessly restart an otherwise-healthy server — that's what the live/ready split prevents.
- Logs are structured (JSON), not string-concatenated — every log line must be grep-able and machine-parseable.

**Timeouts, retry, and cancellation are mandatory, not per-vendor discipline:**

- Per-request timeout and a separate vendor API timeout.
- Retry only on known-transient conditions, bounded exponential backoff.
- No automatic retry of a write unless idempotency is guaranteed (see §7).
- `AbortSignal` propagates from the MCP request through to the vendor call.
- Circuit-breaking or graceful degradation when a vendor is repeatedly failing, rather than hammering a struggling API.

**Versioning.** Every server exposes: scaffold version, server version, MCP protocol/SDK compatibility, tool catalogue version, and vendor API version it targets. Tool name and schema changes after release are breaking changes — see §14 (governance) for how those propagate.

---

## 10. Testing requirements

Every scaffolded server inherits these suites from the template — an FDE adds vendor-specific fixtures, not new test infrastructure.

**Contract tests** (`tests/contract/`)

- Malformed input is rejected by the schema, not by runtime error.
- Output matches the declared `outputSchema` exactly.
- Errors returned to the caller are controlled, never raw vendor stack traces.

**Tenant-isolation tests** (`tests/tenant-isolation/`)

- Tenant A cannot retrieve or act on Tenant B's data, including via a model-supplied tenant override.
- Cached credentials are tenant-scoped — no credential bleed between concurrent requests for different tenants.
- Logs are tenant-labeled and contain no secrets.

**Write-safety tests** (`tests/security/`)

- Write tools are absent entirely when `READ_ONLY=true`.
- A write cannot execute without a preceding dry run when `dryRunRequired: true`.
- An expired or already-used operation token is rejected.
- A `high`-risk action without human approval is blocked.
- Retries are idempotent (no double-charge / double-close class of bug).

**Prompt-injection tests** (`tests/security/`)

- Hostile content planted in ticket descriptions, notes, filenames, and vendor error messages is returned as inert data — never interpreted as an instruction by the server or surfaced in a way that could be mistaken for one.

---

## 11. Deployment modes

Explicit `TRANSPORT`, not inferred from `PORT` presence — implicit mode-switching on an incidental env var is a real footgun (observed directly in one of the reference repos).

```
# Local, read-only, single preset
READ_ONLY=true
MCP_PRESETS=service-desk
TRANSPORT=stdio
```

```
# Production, multi-tenant, Entra-authenticated
PORT=3000
TRANSPORT=http
AUTH_MODE=entra
```

Deployment targets ship as examples in `deploy/`: local, Docker, Azure Container Apps. Every server uses the same pattern — no bespoke infra per vendor.

---

## 12. FDE workflow

**Creating a new server**

1. Clone the template, set vendor + domain metadata.
2. Implement `VendorClient` for the target API.
3. Configure authentication (`AUTH_MODE`, credential provider).
4. Implement `TenantResolver` for the deployment context (single-tenant internal, or multi-tenant client-facing).
5. Add read tools using the tool definition contract (§4).
6. Group tools into presets (§5).
7. Declare required permissions per tool.
8. Run contract + tenant-isolation tests.
9. Add write tools only after reads are validated in production use.
10. Generate the permission manifest and tool catalogue (auto-derived from tool metadata — not hand-maintained).
11. Deploy through the standard pipeline (§11).

**Adding a tool to an existing server**

1. Confirm it's task-shaped, not a raw endpoint wrapper.
2. Classify read or write.
3. Assign a risk level (§7 table).
4. Declare required permissions.
5. Define input and output schemas.
6. Minimize returned data in `execute()`.
7. Assign to a preset.
8. Add contract + (if write) security tests.
9. Add a usage example.

---

## 13. Definition of done

A server is not ready to ship until:

- [ ] Every tool has an owner and a description.
- [ ] Every tool declares access mode, permissions, and risk level.
- [ ] Every write tool declares an approval policy and implements `preview()`.
- [ ] Tenant-isolation tests pass.
- [ ] API credentials are server-managed (never client-supplied plaintext).
- [ ] All outputs are minimized to declared schemas.
- [ ] Secrets are redacted in logs and responses.
- [ ] `READ_ONLY=true` is verified to remove all write tools from the advertised surface.
- [ ] Audit logging is enabled and tenant-labeled.
- [ ] Health endpoint responds correctly.
- [ ] Tool catalogue and permission manifest are generated, not hand-written.
- [ ] Deployment is reproducible from `deploy/` examples.
- [ ] Any borrowed code's license has been reviewed (see `MCP-SCAFFOLD-REFERENCE.md`).

---

## 14. Scaffold governance

Without this, five MCP servers in, each clone starts evolving independently and bug fixes stop propagating. The scaffold should be a package plus template, not just copied source:

```
@nucleus/mcp-core
@nucleus/mcp-testing
@nucleus/mcp-auth-entra
@nucleus/mcp-deploy-azure
```

An individual server then contains mostly `src/vendor/`, `src/tools/`, and `src/presets.ts` — the vendor-specific 20%, not a full copy of the framework.

Governance must define:

- Who owns the template/packages.
- How scaffold changes are versioned and released.
- How existing servers receive upgrades (and whether upgrades are pulled or pushed).
- Which files are generated (never hand-edited) vs. genuinely editable per server.
- How exceptions to the spec get approved, and by whom.
- How security fixes propagate to every deployed server, not just the next one built.
- Compatibility guarantees and deprecation policy for breaking tool/schema changes.

## 15. Scaffold build backlog

### Required for v1

- [x] Create template repository
- [x] Define standard tool metadata contract, including structured `permissions` and `ToolContext` (§4)
- [x] Define `VendorClient` base + capability interface pattern (§6)
- [x] Implement preset-based registration (§5)
- [x] Implement read-only filtering
- [x] Define `AuthenticatedPrincipal`, `TenantResolver`, `CredentialProvider`, `AuthorizationPolicy` (§6)
- [x] Implement structured audit logging (§9)
- [x] Implement dry-run + operation-token workflow, including digest-bound approval and framework-enforced risk baseline (§7)
- [x] Implement idempotency strategy contract (§7)
- [x] Implement `/health/live`, `/health/ready`, `/health/vendor` (§9)
- [x] Implement timeout/retry/circuit-breaking defaults (§9)
- [x] Add reusable tenant-isolation test suite (§10)
- [x] Add example read and write tools (`examples/`)
- [x] Add stdio and HTTP transports with explicit `TRANSPORT` (§11)
- [x] Add Docker and Azure Container Apps deployment examples
- [x] Auto-generate tool catalogue and permission manifest from tool metadata
- [ ] Publish scaffold as versioned packages (`@nucleus/mcp-core`, etc.), not copy-paste source (§14) — this repo currently ships as a clone-and-rename template; see §14 and CONTRIBUTING.md for the path to package extraction.
- [ ] Run the "under a day" acceptance test against a real FDE before calling v1 done

### Deferred to v2

- [ ] Search-based dynamic tool discovery (on top of existing preset registry metadata)
- [ ] Natural-language dispatch tool
- [ ] Prompt/workflow registry (bundled multi-tool sequences, e.g. QBR prep) — a hand-written single-prompt example ships today (`examples/workflow-prompt.ts`); the registry itself does not.
- [ ] Generic `custom_request` fallback module (GET-only, path allow-listed, opt-in via `ENABLE_CUSTOM_REQUEST`)
- [ ] Dashboard/visualization integration
- [ ] Cross-server orchestration

---

## 16. Note on naming convention and vendor prefix

This implementation deliberately deviates from §4's "no vendor name in the tool name" rule:
tools in this repo are prefixed with the vendor/domain (`mockvendor_search_open_tickets`),
following Anthropic's own `mcp-builder` skill convention (`github_create_issue`-style) instead.
Both conventions are defensible — see `docs/ADDING-A-TOOL.md` §4 for the reasoning — but this
repo's `defineTool()` name validation and every shipped example follow the prefixed form. If
your organization prefers the unprefixed form for genuinely single-vendor servers, the
regex in `src/tools/tool-definition.ts` (`NAME_PATTERN`) doesn't force a prefix — only
lowercase snake_case — so either convention is enforceable; pick one and hold it per §4's
"no synonym drift" principle.
