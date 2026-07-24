# Adding a tool

This walks through adding one tool end to end. Read SPEC.md §4 and §7 first if you haven't
— this doc is the "how," SPEC.md is the "why" and the non-negotiable contract.

## 1. Decide: task-shaped, not endpoint-shaped

Ask "what business question is this answering?", not "what REST endpoint am I wrapping?" A
raw `GET /tickets?conditions=...` wrapper pushes the burden of assembling correct filter
syntax onto the model, every single call. `mockvendor_search_open_high_priority_tickets` does
that assembly once, correctly, in your code.

If you're tempted to build a generic `mockvendor_query` tool instead: don't, for v1. See
SPEC.md §1 non-goals — a generic query/dispatch tool is deferred and opt-in for a reason (it
reintroduces the exact correctness burden task-shaped tools exist to remove).

## 2. Classify read or write

Read: doesn't mutate vendor state. Write: does. There is no third option. A tool that reads
_and_ conditionally writes based on its input is two tools, not one — the write half needs a
`preview()` and an approval policy; bolting that onto a tool that's usually a read makes the
common case pay for the risky case's ceremony.

## 3. Assign a risk level

| Risk     | When                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| `low`    | Reads. Always.                                                                       |
| `medium` | Writes with real but boundable/reversible consequences (close a ticket, add a note). |
| `high`   | Deletes, financial actions, anything hard to undo or high-blast-radius.              |

Deletes are **always** `high` — there is no lower tier for a destructive operation. See
`src/tools/risk-level.ts` for the exact platform floor per tier; you may request a _stricter_
policy than your tier's default, never a weaker one (enforced at `defineTool()` call time).

## 4. Name it

`{vendor}_{verb}_{noun}`, lowercase snake_case: `mockvendor_search_open_tickets`,
`mockvendor_get_ticket`, `mockvendor_close_ticket`. A companion preview tool for a write is
auto-named `preview_{tool_name}` by the server — you never register that yourself.

- Prefix with the vendor/domain this server wraps. (This scaffold deliberately follows
  Anthropic's own `mcp-builder` convention here — `github_create_issue`-style — rather than
  the "omit the vendor name" convention some internal specs use for single-vendor servers.
  Consistency with the wider MCP ecosystem's naming habit outweighs the few characters saved
  by dropping it, and it costs nothing once a server ever gains a second vendor/domain.)
- One verb per action type across the whole server: pick `search` vs `list` vs `get` and hold
  it — don't let `fetch_ticket` and `get_agreement` coexist for the same kind of operation.
  `defineTool()` doesn't enforce this one (it's judgment, not a regex) — a naming table in your
  server's README is worth keeping.
- Names are stable after release. Renaming a shipped tool is a breaking change (SPEC.md §9).
- Description states what the tool does **and does not** do — "read-only; does not include
  closed tickets" beats "gets tickets."

## 5. Declare permissions

```ts
permissions: {
  allOf: ["tickets.read"];
}
// or:
permissions: {
  anyOf: [["tickets.admin"], ["tickets.read", "companies.read"]];
}
```

Use the narrowest permission that's true. `tickets.read` if that's genuinely all this tool
needs — not `tickets.admin` because "the role that has admin also has read." Least privilege
is enforced by what you declare here, not by what roles happen to exist today.

## 6. Define input and output schemas

Both **must** be `z.object({...})` — `defineTool()` throws otherwise, because the server
registration layer needs `.shape` to hand to the MCP SDK and outputSchema-as-object is what
makes minimization structural rather than a promise. See `examples/read-tool.ts`.

- Add `.describe()` to non-obvious fields — that text is what the model sees.
- Cap collection-returning params (`limit: z.number().min(1).max(100).default(25)`) — never
  let a tool imply an unbounded result set is possible.
- `outputSchema` is where response minimization happens: whatever `execute()` returns gets
  parsed through it, and zod strips anything not declared. Don't defensively re-strip fields
  in `execute()` — declare the schema correctly and let it do that job.

## 7. Write `execute()` (and `preview()` for writes)

- Never call `fetch` directly — go through your `VendorClient`, which should itself go
  through `VendorHttpClient` (`src/vendor/http-client.ts`) for timeout/retry/circuit-breaking.
  ESLint enforces the first half of this (see `eslint.config.js`).
- `preview()` must be side-effect-free and must return the _exact_ `proposedChanges` that
  `execute()` will produce — the digest binding a token to a preview only means something if
  they genuinely describe the same change. See `src/safety/write-executor.ts`: at execute
  time, the server re-runs your `preview()` against the current input to re-derive the digest
  — if `preview()` has a side effect, that side effect now happens twice.
- Map vendor errors through `src/vendor/errors.ts` classes (`VendorNotFoundError`,
  `VendorAuthError`, ...) so the framework's `toControlledError()` can turn them into a safe
  message. Don't let a raw vendor error/stack trace propagate — that's a contract test failure.

## 8. Assign to a preset

Just declare it: `preset: ["service-desk"]`. Presets are derived from tool declarations, not
a second hand-maintained list — see `src/server/presets.ts` and SPEC.md §5. New preset name?
See `docs/ADDING-A-PRESET.md` (there's nothing to register — using the name is registering it).

## 9. Test it

- Contract: malformed input rejected by the schema (not a runtime throw), output matches
  `outputSchema` exactly. `tests/contract/` has the pattern.
- Write tools additionally need: absent under `READ_ONLY=true`; rejects execute without a
  prior dry run; rejects reused/expired/mismatched operation tokens; `high` risk additionally
  rejects without human approval. `tests/security/write-safety.test.ts` is the template —
  copy its shape for your new write tool.
- Unit-test `execute()`/`preview()` directly against `tests/helpers/context.ts`'s
  `createTestContext()` — you don't need a running server to test tool logic.

## 10. Smoke-test with MCP Inspector

Before calling it done, run the actual server and drive it with
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) (`npx @modelcontextprotocol/inspector npm run dev`) —
confirm the tool shows up with the description/schema you expect, call it with real-ish
input, and for a write tool walk the full `preview_x` → `approve_operation` (if high-risk) →
`x` sequence by hand once. Automated tests catch regressions; this catches "the tool
description reads badly to a model" and "I forgot to wire the preview tool," which they don't.

## The write-tool wire protocol, concretely

For a `medium`-risk write tool named `mockvendor_close_ticket`:

1. Caller calls `preview_mockvendor_close_ticket` with the same input shape. Gets back
   `{ action, target, proposedChanges, digest, operationToken, operationTokenExpiresAt }`.
2. Caller calls `mockvendor_close_ticket` with the original input **plus** `operationToken`.
   The server re-runs `preview()`, re-derives the digest, and only proceeds if it matches.

For a `high`-risk tool, insert a step 1.5: a _different_ authenticated principal calls
`approve_operation` with the `approvalToken` from step 1. Step 2 additionally requires
`approvalToken` in the input.

This protocol only provides real safety if the **host** driving it actually stops at each
gate instead of chaining the calls automatically — see `docs/HOST-INTEGRATION-CONTRACT.md`
before enabling a new write tool for a host you haven't verified against it.

## Optional: bundling a sequence into a prompt

If several tool calls together form a common workflow (daily triage, a monthly report), see
`examples/workflow-prompt.ts` for the MCP "prompt" primitive. It assembles _guidance_, not a
bypass — every tool called still goes through every safety control above.
