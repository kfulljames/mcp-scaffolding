export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying, when `allowed` is false. */
  retryAfterSeconds?: number;
}

export interface RateLimiter {
  checkAndConsume(key: string): RateLimitResult;
}

/**
 * Per-key token bucket — one bucket per authenticated principal (or per
 * tenant, if you construct the key that way), not global. A shared global
 * limit lets one noisy caller starve every other tenant; per-key buckets
 * bound abuse to the abuser. Applied at the HTTP transport boundary
 * (src/server/transports.ts), before a request ever reaches tool
 * authorization — an unauthenticated flood shouldn't even get that far,
 * which is why this runs immediately after `HttpAuthenticator.authenticate`.
 *
 * In-memory, single-instance only — same caveat as
 * InMemoryOperationTokenStore: a horizontally-scaled deployment needs a
 * shared store (Redis `INCR`+`EXPIRE`, or a managed API gateway's rate
 * limiting) so a caller can't reset their budget by landing on a different
 * instance. See docs/KNOWN-GOTCHAS.md.
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefillAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  checkAndConsume(key: string): RateLimitResult {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, lastRefillAt: now };

    const elapsedSeconds = (now - bucket.lastRefillAt) / 1000;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + elapsedSeconds * this.refillPerSecond,
    );
    bucket.lastRefillAt = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      const secondsToNextToken = (1 - bucket.tokens) / this.refillPerSecond;
      return { allowed: false, retryAfterSeconds: Math.ceil(secondsToNextToken) };
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return { allowed: true };
  }
}
