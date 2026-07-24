/**
 * Sanitization applied to untrusted strings before they are logged,
 * audited, or echoed back — NOT before they reach a tool's business logic.
 * Tool input validity is `inputSchema`'s job (SPEC.md §4); this module's
 * job is narrower: make sure hostile content in ticket descriptions, notes,
 * filenames, or vendor error messages can't do log injection (embedded
 * newlines forging fake log lines, terminal escape sequences, etc.) and
 * can't blow past a sane size bound.
 *
 * This module does NOT attempt to detect or strip "prompt injection"
 * content — that is a losing pattern-matching game. The actual defense is
 * architectural: vendor content flows back to the model only as data
 * inside a schema-validated tool result, never concatenated into a system
 * prompt or instruction context. See tests/security/prompt-injection.test.ts,
 * which asserts hostile content survives round-trip as inert data rather
 * than being "cleaned" — cleaning would imply the server is trying (and
 * failing) to interpret it.
 */

// C0 control chars (including newline/CR/tab) plus DEL, built from \u escapes
// so no literal control bytes live in this source file. Newlines are included
// because a forged newline is exactly how untrusted content fakes a new log line.
/* eslint-disable no-control-regex -- intentionally matching C0/DEL control chars; see comment above */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000A-\\u001F\\u007F]", "g");
/* eslint-enable no-control-regex */
const DEFAULT_MAX_LENGTH = 4096;

export function sanitizeForLog(value: string, maxLength = DEFAULT_MAX_LENGTH): string {
  const stripped = value.replace(CONTROL_CHARS, " ");
  return stripped.length > maxLength
    ? `${stripped.slice(0, maxLength)}... [truncated, ${stripped.length} chars total]`
    : stripped;
}

/**
 * Recursively applies `sanitizeForLog` to every string value in an object,
 * for constructing a safe-to-log copy of arbitrary tool input/output.
 * Depth-bounded for the same reason as `redact` in response-redactor.ts.
 */
export function sanitizeForLogDeep(value: unknown, depth = 0): unknown {
  if (depth >= 8) return typeof value === "string" ? sanitizeForLog(value) : value;
  if (typeof value === "string") return sanitizeForLog(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeForLogDeep(v, depth + 1));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitizeForLogDeep(v, depth + 1)]),
    );
  }
  return value;
}
