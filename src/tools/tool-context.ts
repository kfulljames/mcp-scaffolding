import type { AuthenticatedPrincipal } from "../auth/authenticated-principal.js";
import type { ResolvedTenant } from "../auth/tenant-resolver.js";
import type { AuthorizationDecision } from "../auth/authorization-policy.js";
import type { AuditLogger } from "../observability/audit-log.js";
import type { VendorClient } from "../vendor/client.js";

/**
 * Everything a tool's `execute`/`preview` function is handed. Assembled
 * exactly once per request, by the server (src/server/create-server.ts) —
 * a tool author never constructs one directly. There is intentionally no
 * exported factory here for tool code to call; that would let a tool spoof
 * its own principal/tenant/authorization, which defeats the entire safety
 * model. If you find yourself wanting to build a ToolContext inside a
 * tool file, you're probably writing a test — use `tests/helpers/` instead.
 */
export interface ToolContext<TVendor extends VendorClient = VendorClient> {
  requestId: string;
  correlationId: string;
  principal: AuthenticatedPrincipal;
  tenant: ResolvedTenant;
  vendor: TVendor;
  authorization: AuthorizationDecision;
  audit: AuditLogger;
  signal: AbortSignal;
}
