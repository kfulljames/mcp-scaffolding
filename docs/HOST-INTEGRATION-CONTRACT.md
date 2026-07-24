# Host integration contract for write approvals

This server's write-safety lifecycle (SPEC.md §7) assumes cooperation from whatever is on
the other side of the MCP connection — the "host" (an agent runtime, an approvals UI, a
human operator driving an MCP client directly). This scaffold implements the server-side
half correctly regardless of host; it cannot make every host actually _use_ it correctly.
This document is what a host must do for that write-safety model to hold in practice, and
what to do when a host can't.

## The flow, concretely

For a `medium`-risk write tool (say `mockvendor_close_ticket`):

1. Host calls `preview_mockvendor_close_ticket` with the intended input.
2. Server returns `{ action, target, proposedChanges, digest, operationToken, operationTokenExpiresAt }`.
3. The host is expected to **render `action`/`target`/`proposedChanges` to whoever is driving
   the call** before proceeding — that's the entire point of a dry run. A host that silently
   calls `preview_*` and immediately re-calls the real tool with the returned token has
   implemented the dry run as a formality, not a safety control.
4. Host calls `mockvendor_close_ticket` with the original input plus `operationToken`.

For a `high`-risk tool, insert between steps 2 and 4:

2.5. A **distinct, separately-authenticated principal** — not the one that requested the
preview — must call `approve_operation` with the `approvalToken` from step 2. The server
enforces separation of duties (`src/safety/approval-service.ts`); it rejects an approval
attempt whose `subjectId` matches the requester's.

## What a host must support

| Requirement                                                                                       | Why                                                                                                 | If unsupported                                                                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Render `preview_*` output to a human before the real call                                         | The dry-run guarantee is only real if a human (or an equivalent gate) actually sees it              | Do not enable any `medium`+ risk tool for this host — see "Failing closed," below                |
| A distinct, separately-authenticated identity can call `approve_operation`                        | Separation of duties for `high`-risk actions                                                        | Do not enable any `high`-risk tool for this host                                                 |
| Surface the operation digest (or at least `action`/`target`/`proposedChanges`) in the approval UI | An approver approving a digest they can't see isn't meaningfully approving anything                 | Same as above                                                                                    |
| Handle an expired token/approval as a normal, expected failure, not a crash                       | Tokens are short-lived by design (`ttlSeconds`, default 900s) — see `src/safety/operation-token.ts` | Host should re-run `preview_*` and retry the flow, not surface expiry as exceptional             |
| Treat a cancelled/abandoned dry run as inert                                                      | A `preview_*` call never followed by the matching execute call should have no effect                | No action needed — this is already safe by construction; no state changes until `execute()` runs |

## Failing closed

If you're integrating a host that **cannot** guarantee the above — for example, a host that
calls tools autonomously with no human-visible approval surface at all — the correct response
is not "ship it anyway and hope the model behaves." It is one of:

- Deploy that host against `READ_ONLY=true` only, full stop; or
- If writes are genuinely required, restrict the deployment to actions your organization is
  willing to have auto-approved with no human in the loop, and say so explicitly in that
  deployment's own docs — never rely on the model to "be careful" as the actual control.

A model choosing to call a tool is not consent on behalf of the organization that deployed
the server. The approval flow exists precisely because model behavior is not itself the
control — see `docs/SECURITY.md`'s write-safety section for the reasoning.

## What this scaffold does not define

- The actual UI/UX of an approval surface — that's the host's product, not this server's.
- Multi-approver (N-of-M) approval. `ApprovalService` supports one approver per request;
  extend the interface (`src/safety/approval-service.ts`) if your organization needs more.
- Out-of-band approval (Slack, email) triggering `approve_operation`. That's a valid
  integration pattern — the approving "principal" can be a bot account driven by a Slack
  action, for instance — but isn't implemented here. The interface doesn't care how the
  approving principal got authenticated, only that it's a distinct, real
  `AuthenticatedPrincipal`, not a boolean the model produced.

## Verifying a specific host

Before enabling any write tool for a new host integration, walk the flow once by hand — see
`docs/ADDING-A-TOOL.md` step 10 (MCP Inspector) — and confirm the host actually stops and
waits at each gate above rather than chaining the calls automatically. This is exactly what
`mcp-security-reviewer` should be asked to check when a new host integration ships.
