import { describe, expect, it, vi } from "vitest";
import { TokenBucketRateLimiter } from "../../src/safety/rate-limiter.js";

describe("TokenBucketRateLimiter", () => {
  it("allows calls up to the bucket capacity", () => {
    const limiter = new TokenBucketRateLimiter(3, 1);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
  });

  it("denies once the bucket is exhausted and returns a retryAfterSeconds hint", () => {
    const limiter = new TokenBucketRateLimiter(1, 1);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
    const denied = limiter.checkAndConsume("caller-a");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks distinct keys independently — one caller's usage never affects another's budget", () => {
    const limiter = new TokenBucketRateLimiter(1, 1);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
    expect(limiter.checkAndConsume("caller-a").allowed).toBe(false);
    // A different key still has its own full bucket.
    expect(limiter.checkAndConsume("caller-b").allowed).toBe(true);
  });

  it("refills over time at the configured rate", () => {
    vi.useFakeTimers();
    try {
      const limiter = new TokenBucketRateLimiter(1, 1); // 1 token/sec refill
      expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
      expect(limiter.checkAndConsume("caller-a").allowed).toBe(false);

      vi.advanceTimersByTime(1100);
      expect(limiter.checkAndConsume("caller-a").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
