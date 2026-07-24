---
description: Run a pre-merge review of the current MCP server changes using the security and protocol reviewer agents.
---

Review the current uncommitted or unpushed changes to this MCP server.

Dispatch, in parallel:

- the `mcp-security-reviewer` agent — tenant isolation, secret handling, output minimization,
  and write-safety lifecycle correctness. Always run this one.
- the `mcp-protocol-reviewer` agent — protocol lifecycle, transport behavior, and
  `CallToolResult` shape. Skip only if the diff doesn't touch `src/server/create-server.ts`,
  `src/server/transports.ts`, or a tool's `inputSchema`/`outputSchema`/annotations.

Also, before summarizing findings:

- Confirm `npm run verify` passes.
- If the diff adds or changes a tool, fill in the threat-model-delta section of
  `.github/pull_request_template.md` from the actual change (new data read/written,
  permissions, write risk) rather than leaving it as the template placeholder.

Report findings from both agents together, ranked by exploitability — don't just concatenate
their raw output.
