/**
 * Risk classification for a tool's `access` metadata (SPEC.md §4, §7).
 *
 * This is the single source of truth for what write safety controls a tool
 * MUST implement. A tool author declares `risk`; the approval policy the
 * tool must satisfy is derived from this table, not hand-picked per tool.
 * Deletes are always `high` by definition — there is no lower tier for a
 * destructive operation, full stop.
 */
export type RiskLevel = "low" | "medium" | "high";

export interface ApprovalPolicy {
  dryRunRequired: boolean;
  operationTokenRequired: boolean;
  humanApprovalRequired: boolean;
}

/**
 * The platform floor per risk level (SPEC.md §7 table). A tool may declare
 * a *stricter* policy than its risk level requires — never weaker. Weaker
 * declarations are rejected at server startup by `validateApprovalPolicy`,
 * not silently accepted at runtime.
 */
export const RISK_BASELINE: Record<RiskLevel, ApprovalPolicy> = {
  low: {
    dryRunRequired: false,
    operationTokenRequired: false,
    humanApprovalRequired: false,
  },
  medium: {
    dryRunRequired: true,
    operationTokenRequired: true,
    humanApprovalRequired: false,
  },
  high: {
    dryRunRequired: true,
    operationTokenRequired: true,
    humanApprovalRequired: true,
  },
};

export class WeakApprovalPolicyError extends Error {
  constructor(toolName: string, risk: RiskLevel, field: keyof ApprovalPolicy) {
    super(
      `Tool "${toolName}" declares risk="${risk}" but sets ${field}=false, which is ` +
        `weaker than the platform floor (${field}=${String(RISK_BASELINE[risk][field])}). ` +
        `A tool may request stricter controls than its risk level requires, never weaker ones. ` +
        `This is enforced at server startup, not caught at runtime — fix the declaration.`,
    );
    this.name = "WeakApprovalPolicyError";
  }
}

/**
 * Merge an author-declared (partial) approval policy with the risk baseline.
 * Throws if the declared policy is weaker than the floor for its risk level.
 * Call this once, at tool registration time (`defineTool`) — never at
 * request time, where a bug could slip a weak policy past authorization.
 */
export function resolveApprovalPolicy(
  toolName: string,
  risk: RiskLevel,
  declared?: Partial<ApprovalPolicy>,
): ApprovalPolicy {
  const baseline = RISK_BASELINE[risk];
  const resolved: ApprovalPolicy = { ...baseline, ...declared };

  for (const field of Object.keys(baseline) as (keyof ApprovalPolicy)[]) {
    if (baseline[field] && !resolved[field]) {
      throw new WeakApprovalPolicyError(toolName, risk, field);
    }
  }

  return resolved;
}
