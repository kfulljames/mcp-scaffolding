import { describe, expect, it } from "vitest";
import { sanitizeForLog, sanitizeForLogDeep } from "../../src/safety/input-sanitizer.js";
import { redact } from "../../src/safety/response-redactor.js";

describe("sanitizeForLogDeep", () => {
  it("recurses into arrays", () => {
    const result = sanitizeForLogDeep(["a\nb", "c\rd"]) as string[];
    expect(result).toEqual(["a b", "c d"]);
  });

  it("recurses into nested objects", () => {
    const result = sanitizeForLogDeep({ outer: { inner: "x\ny" } }) as {
      outer: { inner: string };
    };
    expect(result.outer.inner).toBe("x y");
  });

  it("leaves non-string primitives untouched", () => {
    expect(sanitizeForLogDeep(42)).toBe(42);
    expect(sanitizeForLogDeep(true)).toBe(true);
    expect(sanitizeForLogDeep(null)).toBe(null);
  });

  it("passes Date instances through unchanged rather than treating them as plain objects", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(sanitizeForLogDeep(date)).toBe(date);
  });

  it("stops recursing past the depth limit without throwing on deeply nested input", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => sanitizeForLogDeep(deep)).not.toThrow();
  });

  it("truncates strings past the max length", () => {
    const long = "x".repeat(5000);
    const result = sanitizeForLog(long);
    expect(result.length).toBeLessThan(5000);
    expect(result).toContain("truncated");
  });
});

describe("redact edge cases", () => {
  it("recurses into arrays of objects", () => {
    const result = redact([{ apiKey: "secret" }, { fine: "ok" }]) as Array<
      Record<string, unknown>
    >;
    expect(result[0]!.apiKey).toBe("[REDACTED]");
    expect(result[1]!.fine).toBe("ok");
  });

  it("passes Date and Error instances through unchanged", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(redact(date)).toBe(date);
    const error = new Error("boom");
    expect(redact(error)).toBe(error);
  });

  it("stops recursing past the depth limit rather than infinite-looping", () => {
    let deep: Record<string, unknown> = { leaf: "value" };
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => redact(deep)).not.toThrow();
  });

  it("leaves primitive values untouched", () => {
    expect(redact(42)).toBe(42);
    expect(redact("plain string")).toBe("plain string");
    expect(redact(null)).toBe(null);
  });
});
