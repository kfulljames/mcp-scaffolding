// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "vitest.config.ts"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A tool author forgetting to `await` a vendor call is exactly the
      // class of bug that turns into an unhandled rejection in production.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Interfaces across this codebase (ToolDefinition.execute/preview, ApprovalService, ...)
      // are Promise-returning by contract even when a given implementation (an example tool,
      // an in-memory reference store) has nothing to await — that's a correct implementation
      // of an async interface, not a bug to flag.
      "@typescript-eslint/require-await": "off",
      // console.* bypasses the redacting structured logger — see src/observability/logger.ts.
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Do not call fetch() directly. Vendor calls must go through VendorHttpClient (src/vendor/http-client.ts) so timeouts, retries, and circuit-breaking apply uniformly.",
        },
      ],
    },
  },
  {
    files: ["tests/**", "examples/**", "scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
  {
    // Integration tests legitimately act as an HTTP *client* driving a real listening
    // instance of our own server (the same role `curl`/MCP Inspector play in manual
    // smoke tests) — that's a different thing from vendor-client code bypassing
    // VendorHttpClient, which is what the no-restricted-syntax rule above targets.
    files: ["tests/integration/**"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // The one sanctioned place fetch() is called directly — every other vendor
    // client is expected to route through this file. See its own doc comment.
    files: ["src/vendor/http-client.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    // AnyToolDefinition (src/tools/tool-definition.ts) is the one sanctioned type-erasure
    // boundary a registry needs to hold heterogeneous tools — see its doc comment. The
    // server layer necessarily crosses that boundary when dispatching to a specific tool.
    files: ["src/server/create-server.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  prettier,
);
