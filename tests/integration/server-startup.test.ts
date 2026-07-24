import { describe, expect, it } from "vitest";
import { loadEnvironment } from "../../src/config/environment.js";
import { ToolRegistry } from "../../src/server/tool-registry.js";
import {
  buildMcpServer,
  type ServerDependencies,
} from "../../src/server/create-server.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { closeTicket } from "../../examples/write-tool.js";
import { listTickets } from "../../examples/paginated-tool.js";
import {
  MockVendorClient,
  type MockVendorCapableClient,
} from "../../examples/vendor/mock-vendor-client.js";
import { SingleTenantResolver } from "../../src/auth/tenant-resolver.js";
import {
  CachingCredentialProvider,
  EnvCredentialProvider,
} from "../../src/auth/credential-provider.js";
import { RoleBasedAuthorizationPolicy } from "../../src/auth/authorization-policy.js";
import { StructuredAuditLogger } from "../../src/observability/audit-log.js";
import { InMemoryMetrics } from "../../src/observability/metrics.js";
import { createLogger } from "../../src/observability/logger.js";
import { InMemoryOperationTokenStore } from "../../src/safety/operation-token.js";
import { InMemoryApprovalService } from "../../src/safety/approval-service.js";
import { createTestPrincipal } from "../helpers/context.js";

function testDeps(
  overrides: Partial<{ READ_ONLY: boolean }> = {},
): ServerDependencies<MockVendorCapableClient> {
  const config = loadEnvironment({
    TRANSPORT: "stdio",
    SERVER_NAME: "test-server",
    SERVER_VERSION: "0.0.0-test",
    READ_ONLY: String(overrides.READ_ONLY ?? true),
    MCP_PRESETS: "service-desk",
    VENDOR_BASE_URL: "https://vendor.test",
    MOCKVENDOR_API_KEY: "test-key",
  });
  const registry = new ToolRegistry().registerAll([
    searchOpenHighPriorityTickets,
    closeTicket,
    listTickets,
  ]);
  return {
    config,
    registry,
    tenantResolver: new SingleTenantResolver({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    }),
    credentialProvider: new CachingCredentialProvider(new EnvCredentialProvider()),
    authorizationPolicy: new RoleBasedAuthorizationPolicy({
      admin: ["tickets.read", "tickets.write"],
    }),
    vendorName: "mockvendor",
    createVendorClient: (credentials, tenant) =>
      new MockVendorClient(credentials, tenant),
    logger: createLogger({ level: "silent", format: "json", name: "test" }),
    auditLogger: new StructuredAuditLogger(
      createLogger({ level: "silent", format: "json", name: "test-audit" }),
    ),
    metrics: new InMemoryMetrics(),
    tokenStore: new InMemoryOperationTokenStore(),
    approvalService: new InMemoryApprovalService(),
  };
}

describe("server startup", () => {
  it("boots with READ_ONLY=true and does not throw constructing the MCP server", () => {
    const deps = testDeps({ READ_ONLY: true });
    const principal = createTestPrincipal({ roles: ["admin"] });
    expect(() => buildMcpServer(principal, deps)).not.toThrow();
  });

  it("boots with READ_ONLY=false and registers write tools plus their preview companions", () => {
    const deps = testDeps({ READ_ONLY: false });
    const principal = createTestPrincipal({ roles: ["admin"] });
    const server = buildMcpServer(principal, deps);
    expect(server).toBeDefined();
  });

  it("resolves the service-desk preset to exactly the tools declared for it", () => {
    const deps = testDeps();
    const resolved = deps.registry.resolvePresets(["service-desk"]);
    expect(resolved.map((t) => t.name).sort()).toEqual(
      [searchOpenHighPriorityTickets.name, closeTicket.name, listTickets.name].sort(),
    );
  });

  it("generates a tool catalogue and permission manifest without hand-written duplication", () => {
    const deps = testDeps();
    const catalogue = deps.registry.generateCatalogue();
    const manifest = deps.registry.generatePermissionManifest();
    expect(catalogue.length).toBe(3);
    expect(manifest[searchOpenHighPriorityTickets.name]).toEqual({
      allOf: ["tickets.read"],
    });
  });
});
