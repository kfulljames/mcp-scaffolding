import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadEnvironment } from "../../src/config/environment.js";
import { ToolRegistry } from "../../src/server/tool-registry.js";
import {
  buildMcpServer,
  type ServerDependencies,
} from "../../src/server/create-server.js";
import { searchOpenHighPriorityTickets } from "../../examples/read-tool.js";
import { closeTicket } from "../../examples/write-tool.js";
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

/**
 * Exercises the real MCP protocol path — a Client and the server built by
 * buildMcpServer() talking over InMemoryTransport.createLinkedPair(), not a
 * unit-level call into ToolDefinition.execute(). This is what actually
 * proves src/server/create-server.ts's registration/dispatch/error-mapping
 * logic works, rather than just that the underlying tool functions do — the
 * same class of check tests/tools/*.test.ts and tests/security/*.test.ts
 * can't reach, and mirrors the manual `curl`/MCP Inspector smoke test this
 * scaffold was validated against (see docs/ADDING-A-TOOL.md step 10).
 */
function testDeps(
  overrides: { READ_ONLY?: boolean } = {},
): ServerDependencies<MockVendorCapableClient> {
  const config = loadEnvironment({
    TRANSPORT: "stdio",
    SERVER_NAME: "protocol-test-server",
    SERVER_VERSION: "0.0.0-test",
    READ_ONLY: String(overrides.READ_ONLY ?? false),
    MCP_PRESETS: "service-desk",
    VENDOR_BASE_URL: "https://vendor.test",
  });
  const registry = new ToolRegistry().registerAll([
    searchOpenHighPriorityTickets,
    closeTicket,
  ]);
  return {
    config,
    registry,
    tenantResolver: new SingleTenantResolver({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    }),
    credentialProvider: new CachingCredentialProvider(
      new EnvCredentialProvider({ MOCKVENDOR_API_KEY: "test-key" }),
    ),
    authorizationPolicy: new RoleBasedAuthorizationPolicy({
      admin: ["tickets.read", "tickets.write"],
      readonly: ["tickets.read"],
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

async function connectedClient(
  deps: ServerDependencies<MockVendorCapableClient>,
  roles: string[] = ["admin"],
): Promise<Client> {
  const server = buildMcpServer(createTestPrincipal({ roles }), deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("MCP protocol: initialize + tools/list", () => {
  it("negotiates capabilities and lists the expected tools with correct annotations", async () => {
    const client = await connectedClient(testDeps());
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual(
      [
        "mockvendor_close_ticket",
        "mockvendor_search_open_high_priority_tickets",
        "preview_mockvendor_close_ticket",
      ].sort(),
    );

    const searchTool = tools.find(
      (t) => t.name === "mockvendor_search_open_high_priority_tickets",
    )!;
    expect(searchTool.annotations?.readOnlyHint).toBe(true);
    expect(searchTool.annotations?.destructiveHint).toBe(false);

    const closeTool = tools.find((t) => t.name === "mockvendor_close_ticket")!;
    expect(closeTool.annotations?.readOnlyHint).toBe(false);
  });

  it("READ_ONLY=true removes write tools and their preview companions from tools/list", async () => {
    const client = await connectedClient(testDeps({ READ_ONLY: true }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      "mockvendor_search_open_high_priority_tickets",
    ]);
  });
});

describe("MCP protocol: tools/call", () => {
  it("returns structuredContent matching outputSchema for a read tool", async () => {
    const client = await connectedClient(testDeps());
    const result = await client.callTool({
      name: "mockvendor_search_open_high_priority_tickets",
      arguments: { limit: 5 },
    });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { tickets: unknown[]; hasMore: boolean };
    expect(typeof payload.hasMore).toBe("boolean");
    expect(Array.isArray(payload.tickets)).toBe(true);
  });

  it("rejects malformed input with isError, not a thrown protocol-level exception", async () => {
    const client = await connectedClient(testDeps());
    const result = await client.callTool({
      name: "mockvendor_search_open_high_priority_tickets",
      arguments: { limit: "not-a-number" },
    });
    expect(result.isError).toBe(true);
  });

  it("denies a call when the principal's role doesn't grant the required permission", async () => {
    const client = await connectedClient(testDeps(), []); // no roles at all
    const result = await client.callTool({
      name: "mockvendor_search_open_high_priority_tickets",
      arguments: { limit: 5 },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/FORBIDDEN/);
  });

  it("full write lifecycle over the real protocol: preview -> execute -> reuse rejected", async () => {
    const client = await connectedClient(testDeps());

    const preview = await client.callTool({
      name: "preview_mockvendor_close_ticket",
      arguments: { ticketId: 1, resolution: "fixed via protocol test" },
    });
    expect(preview.isError).toBeFalsy();
    const previewPayload = preview.structuredContent as { operationToken: string };
    expect(previewPayload.operationToken).toBeTypeOf("string");

    const executed = await client.callTool({
      name: "mockvendor_close_ticket",
      arguments: {
        ticketId: 1,
        resolution: "fixed via protocol test",
        operationToken: previewPayload.operationToken,
      },
    });
    expect(executed.isError).toBeFalsy();
    expect(executed.structuredContent).toEqual({ id: 1, status: "closed" });

    const reused = await client.callTool({
      name: "mockvendor_close_ticket",
      arguments: {
        ticketId: 1,
        resolution: "fixed via protocol test",
        operationToken: previewPayload.operationToken,
      },
    });
    expect(reused.isError).toBe(true);
    expect(JSON.stringify(reused.content)).toMatch(/APPROVAL_REQUIRED/);
  });

  it("rejects execute without a preceding preview call", async () => {
    const client = await connectedClient(testDeps());
    const result = await client.callTool({
      name: "mockvendor_close_ticket",
      arguments: { ticketId: 2, resolution: "no preview first" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/WRITE_VERIFICATION_FAILED/);
  });

  it("maps a vendor-not-found error to a controlled error through preview_*, not a raw exception", async () => {
    const client = await connectedClient(testDeps());
    const result = await client.callTool({
      name: "preview_mockvendor_close_ticket",
      arguments: { ticketId: 999999, resolution: "ticket does not exist" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/VENDOR_NOT_FOUND/);
  });

  it("denies a preview call the same way execute is denied when permission is missing", async () => {
    const client = await connectedClient(testDeps(), []); // no roles
    const result = await client.callTool({
      name: "preview_mockvendor_close_ticket",
      arguments: { ticketId: 1, resolution: "should be forbidden" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/FORBIDDEN/);
  });
});
