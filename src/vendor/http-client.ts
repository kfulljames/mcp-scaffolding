import { VendorApiError, VendorTimeoutError } from "./errors.js";

export interface VendorHttpClientOptions {
  vendorId: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries?: number;
  /** Consecutive transient failures before the breaker opens. */
  circuitBreakerThreshold?: number;
  /** How long the breaker stays open before allowing a trial request. */
  circuitBreakerResetMs?: number;
}

export interface VendorRequestOptions extends Omit<RequestInit, "signal"> {
  /** Only idempotent requests (GET, or a write already covered by an operation token) may retry. */
  idempotent?: boolean;
  signal?: AbortSignal;
}

export class CircuitOpenError extends VendorTimeoutError {
  constructor(vendorId: string) {
    super(
      `Circuit breaker is open for vendor "${vendorId}" after repeated failures — refusing to call ` +
        "further and giving the upstream time to recover rather than hammering a struggling API.",
      vendorId,
    );
  }
}

/**
 * Timeouts, bounded retry, and circuit-breaking, implemented once and
 * shared by every vendor client — SPEC.md §9 is explicit these are
 * mandatory framework behavior, not per-vendor discipline an FDE has to
 * remember to reimplement. A vendor client's HTTP calls should all go
 * through `request()` rather than calling `fetch` directly (the eslint
 * config in this repo enforces this — see eslint.config.js).
 */
export class VendorHttpClient {
  private readonly maxRetries: number;
  private readonly breakerThreshold: number;
  private readonly breakerResetMs: number;
  private consecutiveFailures = 0;
  private breakerOpenedAt: number | null = null;

  constructor(private readonly options: VendorHttpClientOptions) {
    this.maxRetries = options.maxRetries ?? 2;
    this.breakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.breakerResetMs = options.circuitBreakerResetMs ?? 30_000;
  }

  private breakerIsOpen(): boolean {
    if (this.breakerOpenedAt === null) return false;
    if (Date.now() - this.breakerOpenedAt > this.breakerResetMs) {
      // Half-open: allow the next request through as a trial.
      this.breakerOpenedAt = null;
      this.consecutiveFailures = 0;
      return false;
    }
    return true;
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.breakerThreshold) {
      this.breakerOpenedAt = Date.now();
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.breakerOpenedAt = null;
  }

  async request(path: string, options: VendorRequestOptions = {}): Promise<Response> {
    if (this.breakerIsOpen()) {
      throw new CircuitOpenError(this.options.vendorId);
    }

    const { idempotent = false, signal: callerSignal, ...init } = options;
    const attempts = idempotent ? this.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), this.options.timeoutMs);
      const onCallerAbort = (): void => timeoutController.abort();
      callerSignal?.addEventListener("abort", onCallerAbort);

      try {
        const response = await fetch(`${this.options.baseUrl}${path}`, {
          ...init,
          signal: timeoutController.signal,
        });

        if (response.status >= 500 && idempotent && attempt < attempts - 1) {
          lastError = new VendorApiError(
            `Vendor returned ${response.status}`,
            this.options.vendorId,
            response.status,
          );
          await backoff(attempt);
          continue;
        }

        this.recordSuccess();
        return response;
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        const mapped = isAbort
          ? new VendorTimeoutError(
              `Request to ${this.options.vendorId} timed out after ${this.options.timeoutMs}ms`,
              this.options.vendorId,
              error,
            )
          : error;

        this.recordFailure();
        lastError = mapped;

        if (
          idempotent &&
          attempt < attempts - 1 &&
          (isAbort || mapped instanceof TypeError)
        ) {
          await backoff(attempt);
          continue;
        }
        throw mapped;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", onCallerAbort);
      }
    }

    throw lastError;
  }
}

async function backoff(attempt: number): Promise<void> {
  const delayMs = Math.min(200 * 2 ** attempt, 2_000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
