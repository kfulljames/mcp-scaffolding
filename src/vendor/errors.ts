/**
 * Base class for every error a VendorClient implementation throws. Carries
 * the raw vendor detail for logging (never for the caller — see
 * `toControlledError`) and a machine-readable `code` tools/tests can branch
 * on without string-matching a message.
 */
export abstract class VendorError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;

  constructor(
    message: string,
    public readonly vendorId: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class VendorAuthError extends VendorError {
  readonly code = "VENDOR_AUTH_ERROR";
  readonly retryable = false;
}

export class VendorRateLimitError extends VendorError {
  readonly code = "VENDOR_RATE_LIMITED";
  readonly retryable = true;
  constructor(
    message: string,
    vendorId: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message, vendorId, cause);
  }
}

export class VendorTimeoutError extends VendorError {
  readonly code = "VENDOR_TIMEOUT";
  readonly retryable = true;
}

export class VendorNotFoundError extends VendorError {
  readonly code = "VENDOR_NOT_FOUND";
  readonly retryable = false;
}

export class VendorApiError extends VendorError {
  readonly code = "VENDOR_API_ERROR";
  readonly retryable: boolean;
  constructor(
    message: string,
    vendorId: string,
    public readonly httpStatus: number,
    cause?: unknown,
  ) {
    super(message, vendorId, cause);
    // 5xx is presumed transient; 4xx (other than rate-limit/timeout, handled
    // by their own classes) is presumed a caller/input problem and not retried.
    this.retryable = httpStatus >= 500;
  }
}

/** What the caller (tool response / MCP error payload) is allowed to see. */
export interface ControlledError {
  code: string;
  message: string;
}

const GENERIC_MESSAGE = "The upstream vendor system returned an error.";

/**
 * Maps any thrown error to a safe, controlled shape for the caller. This is
 * the ONLY place a vendor error's raw message/stack is allowed to stop
 * propagating outward — contract tests assert callers never see a raw
 * vendor stack trace (SPEC.md §10). Full detail still reaches the audit
 * log / structured logger via `cause`, just never the MCP response.
 */
export function toControlledError(error: unknown): ControlledError {
  if (error instanceof VendorAuthError) {
    return {
      code: error.code,
      message: "Vendor authentication failed. Check server credentials.",
    };
  }
  if (error instanceof VendorRateLimitError) {
    return {
      code: error.code,
      message: "The vendor system is rate-limiting requests. Try again shortly.",
    };
  }
  if (error instanceof VendorTimeoutError) {
    return { code: error.code, message: "The vendor system did not respond in time." };
  }
  if (error instanceof VendorNotFoundError) {
    return { code: error.code, message: "The requested resource was not found." };
  }
  if (error instanceof VendorError) {
    return { code: error.code, message: GENERIC_MESSAGE };
  }
  return { code: "INTERNAL_ERROR", message: "An internal error occurred." };
}
