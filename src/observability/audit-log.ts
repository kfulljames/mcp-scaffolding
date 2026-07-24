import type { Logger } from "./logger.js";
import type { RiskLevel } from "../tools/risk-level.js";

export type AuditOutcome =
  "allowed" | "denied" | "error" | "dry_run" | "approved" | "executed";

/**
 * One structured entry per tool call. Deliberately excludes raw request and
 * response bodies and any credential material — this is an authorization
 * and activity trail, not a debug log. Cross-reference the requestId
 * against structured application logs (which ARE redacted, but do carry
 * more detail) for deep debugging. SPEC.md §9.
 */
export interface AuditEntry {
  timestamp: string;
  requestId: string;
  correlationId: string;
  principalId: string;
  organizationId: string;
  tenantId: string;
  tool: string;
  accessMode: "read" | "write";
  risk: RiskLevel;
  outcome: AuditOutcome;
  reason?: string;
  durationMs?: number;
}

export interface AuditLogger {
  record(entry: AuditEntry): void;
}

/**
 * Reference implementation: writes each entry as one structured log line
 * at the "audit" custom level via the shared logger (already redacting).
 * A real deployment typically also ships these to an immutable sink (SIEM,
 * append-only table) — swap this class, not its interface, when that's needed.
 */
export class StructuredAuditLogger implements AuditLogger {
  constructor(private readonly logger: Logger) {}

  record(entry: AuditEntry): void {
    this.logger.info(
      { audit: true, ...entry },
      `audit: ${entry.tool} -> ${entry.outcome}`,
    );
  }
}
