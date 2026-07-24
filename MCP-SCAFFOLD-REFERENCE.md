# MCP Scaffold Reference

Research memory feeding the Nucleus MCP Scaffold. This is evidence and pattern-sourcing, not the build spec — see `SPEC.md` for the actual architecture an FDE implements against (repository layout, mandatory interfaces, tool contract, write-safety lifecycle, test requirements, definition of done).

Two parts here: patterns worth stealing, and a scorecard of every repo reviewed so a decision doesn't have to be re-derived from scratch. Update this file as new repos get reviewed — don't relitigate in chat, and don't make the FDE read this to start a project. They read `SPEC.md`.

---

## Part 1: Pattern Library

### Architecture

**One server per domain, not monolithic**
Separate servers per app category (PSA, RMM, backup, M365) rather than one giant server. Keeps tool sets small, descriptions focused, avoids confusing the model with overlapping tool names.
_Best example: Wyre `connectwise-manage-mcp` (structure), Wyre's broader `msp-claude-plugins` suite (one repo per app)._

**Task-shaped tools, not endpoint-shaped**
`search_open_high_priority_tickets`, not a raw REST wrapper the model has to assemble filter syntax for correctly every time. Endpoint-per-tool works but pushes correctness burden onto the model.
_Best example: Wyre, `mcp-connectwise-manage` (npm) with semantic tool aliases._

**Lazy-load / dynamic tool discovery**
Don't register all tools upfront — search/discover tools on demand to keep initial context small and avoid the "499 tools dumped into every call" problem (StackJack's core flaw).
_Best example: Softeria `ms-365-mcp-server`'s `--discovery` flag — a real, shipped implementation of exactly this pattern in a 768-star repo. Read this before building your own._

**Presets as a middle ground**
Instead of full dynamic discovery, pre-bundle tools into named categories (e.g. `mail`, `calendar`, `service-desk`, `finance`) as exact allow-lists. Simpler to implement than full search-based discovery; good first step before you need full lazy-load.
_Best example: Softeria `ms-365-mcp-server` — `--preset mail`, `--preset teams`, etc. Each endpoint declares its preset membership so presets never over-match across apps._

**Search-then-execute / generic fallback tool**
A `custom_request`/`gt_dispatch`-style catch-all for the long tail of endpoints not worth hand-building a dedicated tool for. Pairs well with curated tools for the common 80%.
_Best example: jasondsmith72 `CWM-API-Gateway-MCP` (SQLite-backed endpoint search — note: proprietary license, steal the idea not the code). Also ashively101's `custom_request` tool alongside its 140 curated tools._

**Dispatch tool for natural-language routing**
A single tool that routes a plain-text query ("use gt mcp") to the right underlying tool + args, so the person/model doesn't need to memorize tool names.
_Best example: `GroundTruth-MCP`'s `gt_dispatch`._

**Multi-tenant via parameter injection, not N processes**
One server instance serves multiple accounts/tenants; an `account`/`tenant_id` parameter is auto-injected into every tool call rather than spawning one server per tenant. Directly maps to the client-facing multi-tenant design goal.
_Best example: Softeria `ms-365-mcp-server` — collapses tool duplication from N×110 to 110 tools total._

---

### Auth & Security

**OAuth 2.1 / Entra ID as the auth backbone (Microsoft-world clients)**
Not generic API keys. Entra ID auth ties tenant resolution to the token itself instead of a separate lookup layer.
_Best example: Wyre's `AZURE_ACA_DEPLOYMENT.md` + `entra-app-registration.md` (read verbatim before writing your own). Also InditexTech `mcp-teams-server` (SingleTenant/MultiTenant distinction), Softeria `ms-365-mcp-server` (full Azure AD app registration walkthrough)._

**Gateway mode for trusted tenant/identity assertions, not raw vendor credentials**
Per-request headers are a legitimate mechanism for passing trusted tenant and identity assertions in a multi-tenant deployment. They are **not** how vendor credentials should reach the server — vendor secrets are always resolved server-side through a credential provider (Key Vault, Secrets Manager, etc.), never accepted as long-lived plaintext from a client request header.
_Observed in the wild: Wyre `connectwise-manage-mcp`'s `AUTH_MODE=gateway` passes raw CW keys (`X-CW-Company-Id`, `X-CW-Public-Key`, `X-CW-Private-Key`) per request — this is the tenant-routing mechanism worth studying, not the credential-handling model to copy. Nucleus's target architecture is `SPEC.md` §6 (`CredentialProvider`), not this._

**Confirm/dry-run gates on every write operation**
Never bare CRUD. Writes require an explicit confirm or dry-run flag; deletes get extra friction or are excluded entirely. This is the single biggest safety differentiator across everything reviewed — most repos skip it.
_Best example: `mcp-connectwise-manage` (npm) — read-only by default, write allowlist limited to specific operations with confirm/dry-run gates._

**`--read-only` as a first-class server flag**
One switch removes all write tools from what's advertised to the model, rather than gating each tool individually in code.
_Best example: Softeria `ms-365-mcp-server`, CloudScope MCP (permission-enforced, not just code convention)._

**Enforce read-only at the IAM/permission layer, not just in code**
The safety guarantee should live in the platform role (e.g., "Cost Management Reader") rather than relying on the server simply not calling write endpoints. Stronger guarantee — a bug in the server can't accidentally grant write access it was never scoped to have.
_Best example: CloudScope MCP — Azure Cost Management Reader, GCP BigQuery Data Viewer + Job User, no write scope exists at all._

**Scope-derived permissions, not manually tracked**
Compute the required permission/scope set from the enabled tool surface (`--list-permissions`), rather than maintaining a separate doc that drifts out of sync with the actual tools.
_Best example: Softeria `ms-365-mcp-server`._

**Auth via existing session/CLI credential over static API keys**
Where the platform supports it (e.g. `az login`), auto-detect an existing authenticated session instead of requiring manual key creation + copy-paste into env vars.
_Best example: CloudScope MCP._

**Token storage: OS credential store first, file fallback**
Avoid plaintext `.env` credentials where possible. Fall back to file storage with `0600` permissions only when OS keychain isn't available.
_Best example: Softeria `ms-365-mcp-server`._

---

### Developer / Operational Experience

**Prompts as a first-class primitive, not just tools**
Bundle a _sequence_ of tool calls into a named, reusable workflow (e.g. `/monthly-cost-review`) instead of relying on the model to assemble the right sequence fresh each time.
_Best example: CloudScope MCP — `monthly-cost-review`, `waste-audit`, `cost-spike-investigation`, `executive-summary`, `chargeback-report`._

**Document known gotchas as you hit them**
A dedicated "Known Gotchas" README section (build-step traps, env var side effects, one-time secrets) saves real debugging time for whoever builds the next server.
_Best example: ashively101 `MCP-ConnectWise-Manage`'s README (the code itself is unsafe — see scorecard — but the documentation habit is worth copying)._

**Auto stdio/HTTP transport switch based on env var**
`PORT` set → HTTP mode; unset → stdio. Simple, low-friction pattern for supporting both local dev and remote hosting from one codebase.
_Best example: ashively101 `MCP-ConnectWise-Manage`._

**Quality signals beyond stars/forks**
SonarCloud badges (Bugs, Maintainability, Reliability) and OpenSSF Scorecard are objective third-party quality signals. A repo investing in these treats itself as production software.
_Best example: InditexTech `mcp-teams-server`._

**Check the license before treating a public repo as usable**
Public on GitHub ≠ usable license. "Proprietary and confidential, unauthorized use prohibited" repos exist and look identical to MIT ones at a glance.
_Cautionary example: jasondsmith72 `CWM-API-Gateway-MCP`._

---

## Part 2: Repo Scorecard

| Repo                                       | Domain                     | License     | Stars | Verdict                                                                                                                                                               |
| ------------------------------------------ | -------------------------- | ----------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **wyre-technology/connectwise-manage-mcp** | CW PSA                     | Apache-2.0  | ~10   | **Base to fork.** Curated task-shaped tools, gateway multi-tenant mode, Entra ID deployment doc already written. Primary CW pilot foundation.                         |
| **jasondsmith72/CWM-API-Gateway-MCP**      | CW PSA                     | Proprietary | 17    | Steal the search-then-execute idea only. Cannot legally use the code — license forbids it.                                                                            |
| **taddiemason/Connectwise-MCP-Server**     | CW PSA                     | MIT         | 5     | Skip. Not real MCP protocol — OpenWebUI-specific bridge wearing MCP branding.                                                                                         |
| **ashively101/MCP-ConnectWise-Manage**     | CW PSA                     | MIT         | 0     | Steal patterns (custom_request fallback, PORT auto-switch, gotchas doc), don't run unmodified — full CRUD/delete with zero write gating, unvetted single-commit repo. |
| **mcp-connectwise-manage (npm)**           | CW PSA                     | —           | —     | Steal the confirm/dry-run write-gate pattern — best safety design of any CW repo reviewed.                                                                            |
| **Pipedream / ever-works listing**         | CW PSA                     | —           | —     | Not code — a managed connector product. Useful as buy-vs-build market comparator only.                                                                                |
| **CloudScope MCP**                         | Cloud cost (Azure/GCP)     | MIT         | 0     | Different domain. Steal: prompts-as-workflows, IAM-enforced read-only, session-based auth.                                                                            |
| **InditexTech/mcp-teams-server**           | MS Teams                   | Apache-2.0  | 378   | Different domain. Corporate-backed, real quality bar (SonarCloud/Scorecard). Candidate for a later notification/escalation server, not CW.                            |
| **Softeria/ms-365-mcp-server**             | M365 / Graph API           | MIT         | 768   | Different domain but the single best architecture reference reviewed. Read in full — discovery, presets, multi-account, scope-derived perms all shipped and working.  |
| **GroundTruth-MCP**                        | Dev docs / code audit      | Elastic 2.0 | 3     | Unrelated domain. Steal: dispatch-tool pattern, source-priority fallback chain.                                                                                       |
| **mcp-dashboards**                         | Chart/dashboard rendering  | FSL-1.1-MIT | 33    | Unrelated domain. Possible phase-2 pairing with CW server (live ticket/SLA dashboards). Steal: server-side credential presets for live polling.                       |
| **csvglow**                                | CSV/Excel → HTML dashboard | MIT         | 9     | No new patterns — local file processing, no auth/multi-tenant complexity.                                                                                             |
| **changethisfile-mcp**                     | File format conversion     | MIT         | 4     | No new patterns — single external API wrapper, no auth.                                                                                                               |
| **punkpeye/awesome-mcp-servers**           | Directory                  | MIT         | 90.9k | Not a build reference — the master search-first resource. Check here (or `search_mcp_registry`) before building anything new.                                         |
| **microsoft/mcp-for-beginners**            | Curriculum                 | —           | 16.1k | Reference curriculum. Relevant modules: 3.11 (RBAC), 5.3 (OAuth2), 5.12 (Entra ID), Module 11 (multi-tenant RLS labs).                                                |

---

## Part 3: Cross-checked against Anthropic's own `mcp-builder` skill

Anthropic publishes an official MCP-authoring skill
(`anthropics/skills:skills/mcp-builder`, mirrored by `microsoft/skills`). Cross-checking it
against the patterns above and against SPEC.md, mid-build:

**Converges with SPEC.md already:**

- Zod/Pydantic schemas with explicit constraints and inline examples — SPEC.md §4.
- `outputSchema` + structured output as the response-minimization mechanism — SPEC.md §4, §8.
- Actionable, specific error messages rather than generic failures — SPEC.md §10's controlled-error contract test.
- Bounded pagination — SPEC.md §8.
- TypeScript + Streamable HTTP for remote servers, stdio for local — SPEC.md §11.

**Additive, folded into this implementation:**

- **Tool annotation hints** (`readOnlyHint`, `destructiveHint`, `idempotentHint`,
  `openWorldHint`) — the MCP protocol's native way to declare what SPEC.md's
  `access`/`risk`/`idempotency` metadata already captures. Derived automatically at
  registration time (`src/server/create-server.ts`) from each tool's declaration — free,
  no extra author burden.
- **MCP Inspector smoke-testing** and a "10 realistic, independently-verifiable Q&A" manual
  evaluation pattern, as a complement to (not a replacement for) SPEC.md §10's automated
  suites. See `docs/ADDING-A-TOOL.md` step 10.

**Explicit divergence — vendor-prefixed tool names:**
Anthropic's skill recommends vendor-prefixed tool names (`github_create_issue`) for
general-purpose/multi-vendor servers. SPEC.md §4 explicitly says the opposite ("no vendor
name in the tool name unless genuinely ambiguous"), reasoning that this scaffold's
one-server-per-vendor-domain architecture (see "One server per domain" above) makes a
prefix redundant. This implementation follows the vendor-prefixed convention instead
(`mockvendor_search_open_tickets`) per direct instruction during the scaffold's construction —
see SPEC.md §16 for the reasoning and the tradeoff either direction. Both are internally
consistent; pick one per SPEC.md §4's "no synonym drift" principle and hold it.

---

## Status

`SPEC.md` defines the mandatory architecture (repo layout, tool contract, auth/tenant interfaces, write-safety lifecycle, test requirements, definition of done, v1/v2 backlog). This file remains the pattern-sourcing evidence behind that spec — see `SPEC.md` §15 for the actual build backlog, now implemented end-to-end in this repository (v1 items checked off; package extraction and the FDE acceptance test remain open — see §15).
