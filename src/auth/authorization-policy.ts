import type { AuthenticatedPrincipal } from "./authenticated-principal.js";
import type { ResolvedTenant } from "./tenant-resolver.js";
import type { RiskLevel } from "../tools/risk-level.js";

/**
 * A tool's required permissions, declared as an explicit policy rather than
 * a bare string array — `["a", "b"]` is ambiguous about whether it means
 * "needs both" or "needs either." See SPEC.md §4.
 */
export type PermissionRequirement =
  { allOf: string[]; anyOf?: never } | { anyOf: string[][]; allOf?: never };

export function permissionRequirementIsSatisfied(
  requirement: PermissionRequirement,
  granted: ReadonlySet<string>,
): boolean {
  if ("allOf" in requirement && requirement.allOf) {
    return requirement.allOf.every((p) => granted.has(p));
  }
  return requirement.anyOf.some((group) => group.every((p) => granted.has(p)));
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
  /** The permission set the decision was evaluated against, for audit logging. */
  grantedPermissions: string[];
}

/**
 * Can this principal perform this action, for this tenant, at this risk
 * level? Deliberately takes `risk` as an explicit input — a policy is free
 * to require extra conditions (e.g. an elevated role) for `high`-risk calls
 * even when the base permission is granted.
 */
export interface AuthorizationPolicy {
  authorize(request: {
    principal: AuthenticatedPrincipal;
    tenant: ResolvedTenant;
    permission: PermissionRequirement;
    risk: RiskLevel;
  }): Promise<AuthorizationDecision>;
}

/**
 * Default implementation: roles map to a flat permission set via a static
 * table, with an optional extra role gate for high-risk calls. Good enough
 * for a single deployment with a handful of roles; swap for a real policy
 * engine (OPA, Cedar, a database-backed RBAC service) once role/permission
 * mappings need to be managed outside of a deploy.
 */
export class RoleBasedAuthorizationPolicy implements AuthorizationPolicy {
  constructor(
    private readonly rolePermissions: Readonly<Record<string, readonly string[]>>,
    private readonly highRiskRole = "approver",
  ) {}

  authorize(request: {
    principal: AuthenticatedPrincipal;
    tenant: ResolvedTenant;
    permission: PermissionRequirement;
    risk: RiskLevel;
  }): Promise<AuthorizationDecision> {
    const granted = new Set<string>();
    for (const role of request.principal.roles) {
      for (const perm of this.rolePermissions[role] ?? []) {
        granted.add(perm);
      }
    }

    if (!permissionRequirementIsSatisfied(request.permission, granted)) {
      return Promise.resolve({
        allowed: false,
        reason: "Principal's roles do not grant the required permission(s).",
        grantedPermissions: [...granted],
      });
    }

    if (request.risk === "high" && !request.principal.roles.includes(this.highRiskRole)) {
      return Promise.resolve({
        allowed: false,
        reason: `High-risk actions additionally require the "${this.highRiskRole}" role.`,
        grantedPermissions: [...granted],
      });
    }

    return Promise.resolve({
      allowed: true,
      reason: "Permission and risk-tier checks satisfied.",
      grantedPermissions: [...granted],
    });
  }
}
