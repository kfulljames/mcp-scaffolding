import { z } from "zod";

/**
 * Every environment variable this scaffold reads, in one place, validated
 * at startup. An invalid value fails the process before any transport is
 * opened — never surfaces as a confusing runtime error on the first tool
 * call. See docs/KNOWN-GOTCHAS.md for the incidents this prevents.
 */
export const environmentSchema = z
  .object({
    TRANSPORT: z.enum(["stdio", "http"]),
    PORT: z.coerce.number().int().positive().default(3000),

    SERVER_NAME: z.string().min(1),
    SERVER_VERSION: z.string().min(1),

    READ_ONLY: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),

    MCP_PRESETS: z
      .string()
      .min(1, "MCP_PRESETS must name at least one preset")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    AUTH_MODE: z.enum(["none", "api-key", "entra"]).default("none"),
    API_KEYS: z.string().optional(),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_CLIENT_ID: z.string().optional(),
    ENTRA_CLIENT_SECRET: z.string().optional(),

    VENDOR_BASE_URL: z.string().url(),

    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    VENDOR_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(262_144),
    MAX_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(100),
    MAX_PAGES_PER_CALL: z.coerce.number().int().positive().max(50).default(10),

    // Per-principal token bucket at the HTTP boundary — see src/safety/rate-limiter.ts.
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    LOG_FORMAT: z.enum(["json", "pretty"]).default("json"),
  })
  .superRefine((env, ctx) => {
    if (env.TRANSPORT === "http" && env.AUTH_MODE === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "AUTH_MODE=none is single-tenant local dev only and refuses to serve over TRANSPORT=http. " +
          "Set AUTH_MODE=api-key or AUTH_MODE=entra for any network-reachable deployment.",
        path: ["AUTH_MODE"],
      });
    }
    if (env.AUTH_MODE === "api-key" && !env.API_KEYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "API_KEYS is required when AUTH_MODE=api-key",
        path: ["API_KEYS"],
      });
    }
    if (env.AUTH_MODE === "entra") {
      for (const key of [
        "ENTRA_TENANT_ID",
        "ENTRA_CLIENT_ID",
        "ENTRA_CLIENT_SECRET",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key} is required when AUTH_MODE=entra`,
            path: [key],
          });
        }
      }
    }
  });

export type Environment = z.infer<typeof environmentSchema>;
