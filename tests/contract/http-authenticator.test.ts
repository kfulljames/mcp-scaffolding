import { describe, expect, it } from "vitest";
import {
  ApiKeyAuthenticator,
  AuthenticationError,
  EntraAuthenticator,
  NoAuthAuthenticator,
} from "../../src/auth/http-authenticator.js";
import { createTestPrincipal } from "../helpers/context.js";

describe("NoAuthAuthenticator", () => {
  it("always resolves to the fixed principal it was constructed with", async () => {
    const principal = createTestPrincipal({ subjectId: "fixed-local" });
    const authenticator = new NoAuthAuthenticator(principal);
    await expect(authenticator.authenticate({})).resolves.toEqual(principal);
  });
});

describe("ApiKeyAuthenticator", () => {
  const authenticator = new ApiKeyAuthenticator(
    "key-one:user-1:org-1:admin|approver,key-two:user-2:org-2:readonly",
  );

  it("resolves a principal for a valid Bearer key", async () => {
    const principal = await authenticator.authenticate({
      authorization: "Bearer key-one",
    });
    expect(principal).toEqual({
      subjectId: "user-1",
      organizationId: "org-1",
      roles: ["admin", "approver"],
      claims: {},
    });
  });

  it("is case-insensitive on the header name and 'Bearer' scheme", async () => {
    const principal = await authenticator.authenticate({
      Authorization: "bearer key-two",
    });
    expect(principal.subjectId).toBe("user-2");
    expect(principal.roles).toEqual(["readonly"]);
  });

  it("rejects a missing Authorization header", async () => {
    await expect(authenticator.authenticate({})).rejects.toThrow(AuthenticationError);
  });

  it("rejects a malformed (non-Bearer) Authorization header", async () => {
    await expect(
      authenticator.authenticate({ authorization: "Basic dXNlcjpwYXNz" }),
    ).rejects.toThrow(AuthenticationError);
  });

  it("rejects an unrecognized key", async () => {
    await expect(
      authenticator.authenticate({ authorization: "Bearer not-a-real-key" }),
    ).rejects.toThrow(AuthenticationError);
  });

  it("throws at construction time for a malformed API_KEYS entry", () => {
    expect(() => new ApiKeyAuthenticator("missing-fields-only")).toThrow(
      /Malformed API_KEYS entry/,
    );
  });

  it("handles an array-valued header (as Node may provide) by using the first value", async () => {
    const principal = await authenticator.authenticate({
      authorization: ["Bearer key-one"],
    });
    expect(principal.subjectId).toBe("user-1");
  });
});

describe("EntraAuthenticator", () => {
  it("is an explicit stub that always rejects, never a silent pass-through", async () => {
    await expect(new EntraAuthenticator().authenticate({})).rejects.toThrow(
      AuthenticationError,
    );
    await expect(new EntraAuthenticator().authenticate({})).rejects.toThrow(
      /not implemented/,
    );
  });
});
