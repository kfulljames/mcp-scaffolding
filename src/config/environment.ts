import { environmentSchema, type Environment } from "./schema.js";

export class InvalidEnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`,
    );
    this.name = "InvalidEnvironmentError";
  }
}

/**
 * Parse and validate process.env. Call this once, at process startup,
 * before constructing anything else — see src/index.ts. Fail fast: a
 * misconfigured server should never boot into a half-working state.
 */
export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    );
    throw new InvalidEnvironmentError(issues);
  }
  return result.data;
}
