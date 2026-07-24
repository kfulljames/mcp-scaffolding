import { describe, expect, it } from "vitest";
import { MockVendorClient } from "../../examples/vendor/mock-vendor-client.js";
import {
  SingleTenantResolver,
  TenantResolutionError,
} from "../../src/auth/tenant-resolver.js";
import {
  CachingCredentialProvider,
  type CredentialProvider,
} from "../../src/auth/credential-provider.js";
import { redact } from "../../src/safety/response-redactor.js";
import { createTestPrincipal, createTestTenant } from "../helpers/context.js";

describe("tenant A cannot retrieve tenant B's data", () => {
  it("MockVendorClient scoped to tenant A never returns tenant B's tickets", async () => {
    const clientA = new MockVendorClient(
      { apiKey: "key-a" },
      createTestTenant({ tenantId: "tenant-a" }),
    );
    const clientB = new MockVendorClient(
      { apiKey: "key-b" },
      createTestTenant({ tenantId: "tenant-b" }),
    );

    const ticketsA = await clientA.ticketsService.searchOpenHighPriority({ limit: 100 });
    const ticketsB = await clientB.ticketsService.searchOpenHighPriority({ limit: 100 });

    const idsA = new Set(ticketsA.map((t) => t.id));
    const idsB = new Set(ticketsB.map((t) => t.id));
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
    expect(ticketsA.every((t) => t.tenantId === "tenant-a")).toBe(true);
    expect(ticketsB.every((t) => t.tenantId === "tenant-b")).toBe(true);
  });

  it("a model-supplied tenant override is rejected, not silently honored", async () => {
    const resolver = new SingleTenantResolver({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    });
    const principal = createTestPrincipal();

    await expect(resolver.resolve(principal, "tenant-b")).rejects.toThrow(
      TenantResolutionError,
    );
    // The legitimate case still works: no override, or an override matching this server's own tenant.
    await expect(resolver.resolve(principal)).resolves.toEqual({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    });
    await expect(resolver.resolve(principal, "tenant-a")).resolves.toEqual({
      tenantId: "tenant-a",
      displayName: "Tenant A",
    });
  });
});

describe("cached credentials are tenant-scoped — no bleed between concurrent requests", () => {
  it("returns distinct credentials for distinct tenants sharing one cache instance", async () => {
    const calls: string[] = [];
    const delegate: CredentialProvider = {
      getCredentials: (tenant, vendor) => {
        calls.push(tenant.tenantId);
        return Promise.resolve({ apiKey: `key-for-${tenant.tenantId}-${vendor}` });
      },
    };
    const cached = new CachingCredentialProvider(delegate);

    const tenantA = createTestTenant({ tenantId: "tenant-a" });
    const tenantB = createTestTenant({ tenantId: "tenant-b" });

    // Simulate concurrent requests for two different tenants against the same provider instance.
    const [credsA, credsB] = await Promise.all([
      cached.getCredentials(tenantA, "mockvendor"),
      cached.getCredentials(tenantB, "mockvendor"),
    ]);

    expect(credsA.apiKey).toBe("key-for-tenant-a-mockvendor");
    expect(credsB.apiKey).toBe("key-for-tenant-b-mockvendor");
    expect(credsA).not.toEqual(credsB);
  });

  it("serves a cache hit for the same tenant without calling the delegate again", async () => {
    let callCount = 0;
    const delegate: CredentialProvider = {
      getCredentials: () => {
        callCount += 1;
        return Promise.resolve({ apiKey: "stable-key" });
      },
    };
    const cached = new CachingCredentialProvider(delegate);
    const tenant = createTestTenant();

    await cached.getCredentials(tenant, "mockvendor");
    await cached.getCredentials(tenant, "mockvendor");
    expect(callCount).toBe(1);
  });
});

describe("audit entries are tenant-labeled and contain no secrets", () => {
  it("redact() strips a nested credential-shaped field from an audit-adjacent payload", () => {
    const entry = {
      tenantId: "tenant-a",
      tool: "mockvendor_search_open_high_priority_tickets",
      vendorDetails: { apiKey: "should-never-appear-in-a-log" },
    };
    const redacted = redact(entry) as Record<string, unknown>;
    expect(redacted.tenantId).toBe("tenant-a");
    expect((redacted.vendorDetails as Record<string, unknown>).apiKey).toBe("[REDACTED]");
  });

  it("redact() replaces an entire value whose OWN key looks credential-shaped, not just its children", () => {
    const entry = { tenantId: "tenant-a", vendorCredentials: { apiKey: "leak-me" } };
    const redacted = redact(entry) as Record<string, unknown>;
    // The key "vendorCredentials" itself matches the sensitive-key pattern, so the whole
    // value is replaced wholesale — a stricter, still-safe outcome, not a bug.
    expect(redacted.vendorCredentials).toBe("[REDACTED]");
  });
});
