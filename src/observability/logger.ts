import pino from "pino";
import { redact } from "../safety/response-redactor.js";
import { getRequestContext } from "./correlation.js";

export interface LoggerOptions {
  level: string;
  format: "json" | "pretty";
  name: string;
}

/**
 * The only supported way to log in this codebase — `console.*` is banned
 * by eslint (see eslint.config.js) precisely so nothing bypasses redaction
 * or structured output. Every log line is JSON (grep-able, machine
 * parseable, SPEC.md §9) except in local dev with LOG_FORMAT=pretty, which
 * must never be the format a shipped container uses.
 */
export function createLogger(options: LoggerOptions): pino.Logger {
  return pino({
    name: options.name,
    level: options.level,
    // Redact every log object before it's serialized — a tool author logging
    // `{ input }` verbatim still gets secrets stripped automatically.
    formatters: {
      log(object) {
        return redact(object) as Record<string, unknown>;
      },
    },
    mixin() {
      const ctx = getRequestContext();
      return ctx
        ? {
            requestId: ctx.requestId,
            correlationId: ctx.correlationId,
            tenantId: ctx.tenantId,
          }
        : {};
    },
    transport:
      options.format === "pretty"
        ? {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "HH:MM:ss" },
          }
        : undefined,
  });
}

export type Logger = pino.Logger;
