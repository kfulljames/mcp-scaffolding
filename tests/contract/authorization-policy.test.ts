import { describe, expect, it } from "vitest";
import {
  RoleBasedAuthorizationPolicy,
  permissionRequirementIsSatisfied,
} from "../../src/auth/authorization-policy.js";
import { createTestPrincipal, createTestTenant } from "../helpers/context.js";

describe("permissionRequirementIsSatisfied", () => {
  it("allOf requires every listed permission", () => {
    const granted = new Set(["tickets.read"]);
    expect(permissionRequirementIsSatisfied({ allOf: ["tickets.read"] }, granted)).toBe(
      true,
    );
    expect(
      permissionRequirementIsSatisfied(
        { allOf: ["tickets.read", "tickets.write"] },
        granted,
      ),
    ).toBe(false);
  });

  it("anyOf is satisfied if any one group is fully granted", () => {
    const granted = new Set(["tickets.admin"]);
    expect(
      permissionRequirementIsSatisfied(
        { anyOf: [["tickets.admin"], ["tickets.read", "companies.read"]] },
        granted,
      ),
    ).toBe(true);
    expect(
      permissionRequirementIsSatisfied(
        { anyOf: [["tickets.read", "companies.read"]] },
        granted,
      ),
    ).toBe(false);
  });
});

describe("RoleBasedAuthorizationPolicy", () => {
  const policy = new RoleBasedAuthorizationPolicy({
    admin: ["tickets.read", "tickets.write"],
    readonly: ["tickets.read"],
  });
  const tenant = createTestTenant();

  it("allows when the principal's roles grant the required permission at low risk", async () => {
    const decision = await policy.authorize({
      principal: createTestPrincipal({ roles: ["readonly"] }),
      tenant,
      permission: { allOf: ["tickets.read"] },
      risk: "low",
    });
    expect(decision.allowed).toBe(true);
    expect(decision.grantedPermissions).toEqual(["tickets.read"]);
  });

  it("denies when no role grants the required permission", async () => {
    const decision = await policy.authorize({
      principal: createTestPrincipal({ roles: ["readonly"] }),
      tenant,
      permission: { allOf: ["tickets.write"] },
      risk: "low",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/do not grant/);
  });

  it("denies a high-risk call for a principal without the approver role, even with the base permission", async () => {
    const decision = await policy.authorize({
      principal: createTestPrincipal({ roles: ["admin"] }),
      tenant,
      permission: { allOf: ["tickets.write"] },
      risk: "high",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/approver/);
  });

  it("allows a high-risk call once the principal also has the configured high-risk role", async () => {
    const decision = await policy.authorize({
      principal: createTestPrincipal({ roles: ["admin", "approver"] }),
      tenant,
      permission: { allOf: ["tickets.write"] },
      risk: "high",
    });
    expect(decision.allowed).toBe(true);
  });

  it("a principal with no roles is granted nothing", async () => {
    const decision = await policy.authorize({
      principal: createTestPrincipal({ roles: [] }),
      tenant,
      permission: { allOf: ["tickets.read"] },
      risk: "low",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.grantedPermissions).toEqual([]);
  });
});
