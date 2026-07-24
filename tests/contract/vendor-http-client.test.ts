import { afterEach, describe, expect, it, vi } from "vitest";
import { CircuitOpenError, VendorHttpClient } from "../../src/vendor/http-client.js";
import { VendorTimeoutError } from "../../src/vendor/errors.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: typeof fetch): void {
  vi.stubGlobal("fetch", vi.fn(impl));
}

describe("VendorHttpClient", () => {
  it("returns the response on success and resets the failure counter", async () => {
    stubFetch(async () => new Response("{}", { status: 200 }));
    const client = new VendorHttpClient({
      vendorId: "v",
      baseUrl: "https://vendor.test",
      timeoutMs: 1000,
    });

    const response = await client.request("/ping");
    expect(response.status).toBe(200);
  });

  it("maps an aborted (timed-out) request to VendorTimeoutError", async () => {
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const client = new VendorHttpClient({
      vendorId: "v",
      baseUrl: "https://vendor.test",
      timeoutMs: 10,
    });

    await expect(client.request("/slow")).rejects.toThrow(VendorTimeoutError);
  });

  it("does not retry a non-idempotent request — fails on the first error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new VendorHttpClient({
      vendorId: "v",
      baseUrl: "https://vendor.test",
      timeoutMs: 1000,
      maxRetries: 3,
    });

    await expect(client.request("/write", { method: "POST" })).rejects.toThrow(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent request on a 5xx response, up to maxRetries", async () => {
    const fetchMock = vi.fn(async () => new Response("error", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new VendorHttpClient({
      vendorId: "v",
      baseUrl: "https://vendor.test",
      timeoutMs: 1000,
      maxRetries: 1,
    });

    const response = await client.request("/read", { idempotent: true });
    expect(response.status).toBe(503); // still fails after exhausting retries — caller decides what to do
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it("opens the circuit after consecutive failures and short-circuits without calling fetch", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new VendorHttpClient({
      vendorId: "v",
      baseUrl: "https://vendor.test",
      timeoutMs: 1000,
      circuitBreakerThreshold: 2,
      circuitBreakerResetMs: 60_000,
    });

    await expect(client.request("/a")).rejects.toThrow(TypeError);
    await expect(client.request("/b")).rejects.toThrow(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Third call should trip the open breaker and never reach fetch again.
    await expect(client.request("/c")).rejects.toThrow(CircuitOpenError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
