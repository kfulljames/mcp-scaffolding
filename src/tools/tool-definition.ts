import { ZodObject, type ZodType, type ZodTypeDef } from "zod";
import type { PermissionRequirement } from "../auth/authorization-policy.js";
import type { VendorClient } from "../vendor/client.js";
import type { ToolContext } from "./tool-context.js";
import {
  resolveApprovalPolicy,
  type ApprovalPolicy,
  type RiskLevel,
} from "./risk-level.js";

export type AccessMode = "read" | "write";

export interface ToolAccess {
  mode: AccessMode;
  permissions: PermissionRequirement;
  risk: RiskLevel;
}

export interface IdempotencyStrategy {
  strategy: "operation-token" | "vendor-native" | "none";
  ttlSeconds?: number;
}

export interface ToolPreview {
  action: string;
  target: string;
  proposedChanges: Record<string, unknown>;
}

export interface ToolDefinitionInput<
  TInput,
  TOutput,
  TVendor extends VendorClient = VendorClient,
> {
  name: string;
  description: string;
  /** At least one preset. A tool with no preset assigned does not ship — SPEC.md §4. */
  preset: string[];
  access: ToolAccess;
  // The third (Input-before-parse) generic is pinned to `unknown` rather than left to
  // default to TInput — zod's default is `Input = Output`, which would force TypeScript
  // to unify TInput against BOTH the schema's parsed-output type AND its pre-parse input
  // type simultaneously (e.g. widening a `.default(25)`-backed field back to `number |
  // undefined`). `.parse()` always accepts `unknown` regardless of this parameter, so
  // pinning it here costs nothing and keeps TInput equal to the schema's true output type.
  inputSchema: ZodType<TInput, ZodTypeDef, unknown>;
  /** Mandatory. Output is always parsed through this — a tool cannot return the raw vendor payload. */
  outputSchema: ZodType<TOutput, ZodTypeDef, unknown>;
  /** Stricter-than-baseline overrides only; see risk-level.ts. Omit to take the risk-tier default. */
  approval?: Partial<ApprovalPolicy>;
  idempotency?: IdempotencyStrategy;
  /** Mandatory for access.mode === "write" — see SPEC.md §7. */
  preview?: (input: TInput, context: ToolContext<TVendor>) => Promise<ToolPreview>;
  execute: (input: TInput, context: ToolContext<TVendor>) => Promise<TOutput>;
}

export interface ToolDefinition<
  TInput = unknown,
  TOutput = unknown,
  TVendor extends VendorClient = VendorClient,
> {
  name: string;
  description: string;
  preset: string[];
  access: ToolAccess;
  approvalPolicy: ApprovalPolicy;
  idempotency: IdempotencyStrategy;
  inputSchema: ZodType<TInput>;
  outputSchema: ZodType<TOutput>;
  preview?: (input: TInput, context: ToolContext<TVendor>) => Promise<ToolPreview>;
  execute: (input: TInput, context: ToolContext<TVendor>) => Promise<TOutput>;
}

export class InvalidToolDefinitionError extends Error {
  constructor(name: string, reason: string) {
    super(`Invalid tool definition "${name}": ${reason}`);
    this.name = "InvalidToolDefinitionError";
  }
}

const NAME_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const DELETE_NAME_PATTERN = /(^|_)(delete|remove|destroy|purge)(_|$)/;

/**
 * The single source of truth for a tool. Registration, preset membership,
 * permission calculation, read-only filtering, audit classification,
 * catalogue generation, and the automated security test suite all derive
 * from what's declared here — see SPEC.md §4. Validation happens once, at
 * definition time (module load / server startup), so a bad declaration
 * fails the build rather than surfacing as a runtime surprise in production.
 */
export function defineTool<TInput, TOutput, TVendor extends VendorClient = VendorClient>(
  input: ToolDefinitionInput<TInput, TOutput, TVendor>,
): ToolDefinition<TInput, TOutput, TVendor> {
  if (
    !(input.inputSchema instanceof ZodObject) ||
    !(input.outputSchema instanceof ZodObject)
  ) {
    throw new InvalidToolDefinitionError(
      input.name,
      "inputSchema and outputSchema must both be a `z.object({...})` — the server registration layer " +
        "relies on `.shape` to hand raw field schemas to the MCP SDK, and outputSchema-as-object is " +
        "what makes structuredContent minimization possible.",
    );
  }
  if (!NAME_PATTERN.test(input.name)) {
    throw new InvalidToolDefinitionError(
      input.name,
      "name must be lowercase snake_case, prefixed with the vendor/domain this server wraps, " +
        "verb next (e.g. `connectwise_search_open_tickets`, `ninjaone_list_devices`). " +
        "See docs/ADDING-A-TOOL.md.",
    );
  }
  if (input.preset.length === 0) {
    throw new InvalidToolDefinitionError(
      input.name,
      "must declare at least one preset — tools with no preset do not ship (SPEC.md §4).",
    );
  }
  if (input.access.mode === "write" && !input.preview) {
    throw new InvalidToolDefinitionError(
      input.name,
      "write tools must implement preview() — it is what the dry-run flow calls before execute() " +
        "is ever reachable (SPEC.md §7).",
    );
  }
  if (input.access.mode === "write" && input.access.risk === "low") {
    // A "low" risk write is a contradiction in this scaffold's model: every write
    // mutates vendor state for a real tenant, which is never zero-consequence.
    throw new InvalidToolDefinitionError(
      input.name,
      'write tools must declare risk "medium" or "high" — there is no low-risk write.',
    );
  }
  if (
    input.access.mode === "write" &&
    DELETE_NAME_PATTERN.test(input.name) &&
    input.access.risk !== "high"
  ) {
    // SPEC.md §7: "Deletes are risk: 'high' by definition." A human declaring the wrong
    // risk tier for an obviously-destructive tool is exactly the mistake this check exists
    // to catch at registration time rather than in production. This is a name heuristic,
    // not a semantic analysis — it can't catch every destructive tool (nor should it try
    // to guess), but a tool whose OWN name says delete/remove has no excuse.
    throw new InvalidToolDefinitionError(
      input.name,
      'a tool named with delete/remove semantics must declare risk "high" — deletes are ' +
        "always high-risk by definition (SPEC.md §7).",
    );
  }

  const approvalPolicy = resolveApprovalPolicy(
    input.name,
    input.access.risk,
    input.approval,
  );

  if (input.access.mode === "write" && approvalPolicy.operationTokenRequired) {
    const idempotency = input.idempotency ?? {
      strategy: "operation-token",
      ttlSeconds: 900,
    };
    if (idempotency.strategy === "none") {
      throw new InvalidToolDefinitionError(
        input.name,
        "a write tool whose risk tier requires an operation token must declare an idempotency " +
          'strategy other than "none" — automatic retry of an unsafe mutation is never permitted (SPEC.md §7).',
      );
    }
    return {
      name: input.name,
      description: input.description,
      preset: input.preset,
      access: input.access,
      approvalPolicy,
      idempotency,
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      preview: input.preview,
      execute: input.execute,
    };
  }

  return {
    name: input.name,
    description: input.description,
    preset: input.preset,
    access: input.access,
    approvalPolicy,
    idempotency: input.idempotency ?? { strategy: "none" },
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    preview: input.preview,
    execute: input.execute,
  };
}

/**
 * A registry necessarily holds tools with different Input/Output/Vendor
 * types side by side — that's an existential type, which TypeScript can
 * only express by erasing to `any` here. This is the one sanctioned spot;
 * every call site narrows immediately via `tool.inputSchema.parse(...)`
 * before touching the erased value, so the erasure never leaks further.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any, any, any>;
