/**
 * Key names treated as secret-shaped anywhere they appear in a nested
 * object — logs, audit entries, and (as a last-resort backstop) tool
 * responses. Matched case-insensitively as a substring so `apiKey`,
 * `api_key`, `X-Api-Key`, and `clientApiKeySecret` all match.
 */
const SENSITIVE_KEY_PATTERN =
  /(password|secret|token|api[-_]?key|authorization|credential|private[-_]?key|client[-_]?secret|refresh[-_]?token|access[-_]?token|cookie|set-cookie)/i;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;

/**
 * Deep-clones `value`, replacing any value whose key matches a
 * secret-shaped pattern with a fixed redaction marker. This is applied
 * uniformly by the logger and audit logger (SPEC.md §8, §9) — a tool
 * author does not need to remember to redact anything themselves.
 *
 * Depth-bounded to avoid pathological/cyclic input turning a log call into
 * a hang; anything past MAX_DEPTH is summarized rather than recursed into.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return typeof value === "object" && value !== null ? "[MAX_DEPTH_EXCEEDED]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value instanceof Date || value instanceof Error) {
    return value;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return value;
}
