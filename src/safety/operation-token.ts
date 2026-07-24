import { createHash, randomBytes } from "node:crypto";

/**
 * Deterministic JSON stringification (recursively sorted object keys) so
 * the same logical payload always hashes to the same digest regardless of
 * property insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * `operationToken`/`approvalToken` are plumbing, not business input: they don't exist
 * yet when `preview()` first computes a digest, and they're only present on the
 * `execute()`-time input. Including them in the hashed payload would make every
 * legitimate token look "mismatched" the moment it was actually attached to the
 * request it belongs to — always call this before `computeOperationDigest`.
 */
export function stripControlFields<T extends Record<string, unknown>>(
  input: T,
): Omit<T, "operationToken" | "approvalToken"> {
  const {
    operationToken: _operationToken,
    approvalToken: _approvalToken,
    ...rest
  } = input;
  return rest;
}

/**
 * `hash(tool + tenant + normalized input + proposed changes)` — SPEC.md §7.
 * This digest is what binds a preview to the execute() call that follows
 * it: change the payload after preview and the digest changes, which
 * invalidates any operation token or human approval issued against the
 * old one. Callers must pass `input` through `stripControlFields` first —
 * see its doc comment.
 */
export function computeOperationDigest(params: {
  tool: string;
  tenantId: string;
  input: unknown;
  proposedChanges: unknown;
}): string {
  const payload = stableStringify({
    tool: params.tool,
    tenantId: params.tenantId,
    input: params.input,
    proposedChanges: params.proposedChanges,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export interface IssuedOperationToken {
  token: string;
  digest: string;
  expiresAt: number;
}

export class OperationTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationTokenError";
  }
}

/**
 * Issues and consumes single-use, short-lived, digest-bound operation
 * tokens. A token proves a preview was shown before the mutating call
 * happened and can never be replayed — `consume` deletes it on first use,
 * whether that use succeeds or fails digest verification.
 *
 * This in-memory implementation is correct for a single server instance
 * only. A multi-instance/horizontally-scaled deployment MUST replace this
 * with a shared store (Redis, etc.) or a token consumed on instance A will
 * still appear valid on instance B — see docs/KNOWN-GOTCHAS.md.
 */
export interface OperationTokenStore {
  issue(digest: string, ttlSeconds: number): IssuedOperationToken;
  consume(token: string, expectedDigest: string): void;
}

export class InMemoryOperationTokenStore implements OperationTokenStore {
  private readonly tokens = new Map<string, { digest: string; expiresAt: number }>();

  issue(digest: string, ttlSeconds: number): IssuedOperationToken {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.tokens.set(token, { digest, expiresAt });
    return { token, digest, expiresAt };
  }

  consume(token: string, expectedDigest: string): void {
    const record = this.tokens.get(token);
    // Delete unconditionally: whether the check below passes or fails, this
    // token must never be usable again — that's what "single-use" means.
    this.tokens.delete(token);

    if (!record) {
      throw new OperationTokenError(
        "Operation token is invalid, expired, or already used.",
      );
    }
    if (record.expiresAt < Date.now()) {
      throw new OperationTokenError("Operation token has expired.");
    }
    if (record.digest !== expectedDigest) {
      throw new OperationTokenError(
        "Operation token does not match this request's payload — the input changed after preview.",
      );
    }
  }
}
