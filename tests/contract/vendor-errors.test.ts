import { describe, expect, it } from "vitest";
import {
  VendorApiError,
  VendorAuthError,
  VendorNotFoundError,
  VendorRateLimitError,
  VendorTimeoutError,
  toControlledError,
} from "../../src/vendor/errors.js";

describe("toControlledError", () => {
  it("maps each vendor error class to a safe, distinct code and message", () => {
    const authControlled = toControlledError(
      new VendorAuthError("raw detail with secrets", "v"),
    );
    expect(authControlled.code).toBe("VENDOR_AUTH_ERROR");
    expect(authControlled.message).not.toContain("raw detail");
    expect(toControlledError(new VendorRateLimitError("raw detail", "v")).code).toBe(
      "VENDOR_RATE_LIMITED",
    );
    expect(toControlledError(new VendorTimeoutError("raw detail", "v")).code).toBe(
      "VENDOR_TIMEOUT",
    );
    expect(toControlledError(new VendorNotFoundError("raw detail", "v")).code).toBe(
      "VENDOR_NOT_FOUND",
    );
  });

  it("never leaks the raw vendor message for a generic VendorApiError", () => {
    const controlled = toControlledError(
      new VendorApiError("Internal DB dump: user=admin pass=hunter2", "v", 500),
    );
    expect(controlled.code).toBe("VENDOR_API_ERROR");
    expect(controlled.message).not.toContain("hunter2");
  });

  it("never leaks a raw stack trace or message for a completely unexpected error", () => {
    const controlled = toControlledError(
      new Error("Segfault at 0xdeadbeef, credentials=abc123"),
    );
    expect(controlled.code).toBe("INTERNAL_ERROR");
    expect(controlled.message).not.toContain("abc123");
    expect(controlled.message).not.toContain("0xdeadbeef");
  });

  it("handles a thrown non-Error value without crashing", () => {
    expect(() => toControlledError("just a string")).not.toThrow();
    expect(toControlledError("just a string").code).toBe("INTERNAL_ERROR");
  });
});

describe("VendorApiError retryability", () => {
  it("treats 5xx as retryable and other statuses as not", () => {
    expect(new VendorApiError("x", "v", 503).retryable).toBe(true);
    expect(new VendorApiError("x", "v", 500).retryable).toBe(true);
    expect(new VendorApiError("x", "v", 404).retryable).toBe(false);
    expect(new VendorApiError("x", "v", 400).retryable).toBe(false);
  });
});

describe("VendorRateLimitError", () => {
  it("is retryable and carries an optional retryAfterMs", () => {
    const err = new VendorRateLimitError("rate limited", "v", 5000);
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(5000);
  });
});
