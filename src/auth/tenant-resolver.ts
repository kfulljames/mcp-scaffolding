import type { AuthenticatedPrincipal } from "./authenticated-principal.js";

/**
 * The tenant/customer account a call is authorized to act on, after
 * resolution — never the raw string the model passed in a tool argument.
 */
export interface ResolvedTenant {
  tenantId: string;
  displayName: string;
}

export class TenantResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/**
 * Resolves which tenant a principal may act on for this call.
 *
 * SPEC.md §2, principle 1: "A `tenant_id` the model passes in a tool call
 * is a hint, not an authorization." `requestedTenant` is exactly that hint
 * — it comes straight from tool input and MUST NOT be trusted as-is.
 * Implementations decide whether a requested tenant is permitted for this
 * principal (multi-tenant gateway case) or ignore it entirely
 * (single-tenant internal case) and MUST reject silently-wrong guesses
 * rather than default to "first tenant available."
 */
export interface TenantResolver {
  resolve(
    principal: AuthenticatedPrincipal,
    requestedTenant?: string,
  ): Promise<ResolvedTenant>;
}

/**
 * For internal, single-tenant deployments. Always resolves to the same
 * configured tenant regardless of what the model requests — this keeps the
 * internal pilot on the identical code path as the future multi-tenant
 * product; nothing gets rewritten when a server graduates to multi-tenant.
 *
 * If a caller explicitly requests a *different* tenant than the one this
 * server is scoped to, that is treated as a request for data this server
 * cannot serve and rejected — not silently redirected to the configured
 * tenant, which would mask a real bug in the caller.
 */
export class SingleTenantResolver implements TenantResolver {
  constructor(private readonly tenant: ResolvedTenant) {}

  resolve(
    _principal: AuthenticatedPrincipal,
    requestedTenant?: string,
  ): Promise<ResolvedTenant> {
    if (requestedTenant && requestedTenant !== this.tenant.tenantId) {
      return Promise.reject(
        new TenantResolutionError(
          `This server is scoped to tenant "${this.tenant.tenantId}"; ` +
            `"${requestedTenant}" was requested and cannot be served.`,
        ),
      );
    }
    return Promise.resolve(this.tenant);
  }
}
