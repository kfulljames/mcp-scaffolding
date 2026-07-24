import type { ToolContext } from "../../src/tools/tool-context.js";
import type { AuthenticatedPrincipal } from "../../src/auth/authenticated-principal.js";
import type { ResolvedTenant } from "../../src/auth/tenant-resolver.js";
import type { AuditEntry, AuditLogger } from "../../src/observability/audit-log.js";
import {
  MockVendorClient,
  type MockVendorCapableClient,
} from "../../examples/vendor/mock-vendor-client.js";

/**
 * The only sanctioned way to build a ToolContext outside src/server —
 * see the comment on ToolContext in src/tools/tool-context.ts. A tool
 * file must never construct one of these itself.
 */
export class RecordingAuditLogger implements AuditLogger {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

export function createTestPrincipal(
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal {
  return {
    subjectId: "test-user",
    organizationId: "test-org",
    roles: ["admin"],
    claims: {},
    ...overrides,
  };
}

export function createTestTenant(
  overrides: Partial<ResolvedTenant> = {},
): ResolvedTenant {
  return { tenantId: "tenant-a", displayName: "Test Tenant A", ...overrides };
}

export function createTestContext(
  overrides: Partial<{
    principal: AuthenticatedPrincipal;
    tenant: ResolvedTenant;
    audit: AuditLogger;
    allowed: boolean;
  }> = {},
): ToolContext<MockVendorCapableClient> {
  const principal = overrides.principal ?? createTestPrincipal();
  const tenant = overrides.tenant ?? createTestTenant();
  return {
    requestId: "test-request-id",
    correlationId: "test-correlation-id",
    principal,
    tenant,
    vendor: new MockVendorClient({ apiKey: "test-key" }, tenant),
    authorization: {
      allowed: overrides.allowed ?? true,
      reason: "test context",
      grantedPermissions: ["tickets.read", "tickets.write"],
    },
    audit: overrides.audit ?? new RecordingAuditLogger(),
    signal: new AbortController().signal,
  };
}
