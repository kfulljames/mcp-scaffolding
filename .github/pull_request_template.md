## Summary

<!-- What changed and why, in 1-3 bullets. -->

## Threat-model delta

<!-- Required for any change touching src/tools/, src/vendor/, src/auth/, or src/safety/.
     Fill in only what actually changed — leave a field empty/none if it doesn't apply.
     See docs/SECURITY.md, docs/HOST-INTEGRATION-CONTRACT.md, and the mcp-security-reviewer
     agent for what to check before filling this in. -->

```yaml
newDataRead: [] # vendor fields newly readable, e.g. ticket.summary
newDataWritten: [] # vendor fields newly writable
newPermissions: [] # e.g. tickets.write
newExternalEndpoints: [] # vendor endpoints newly called
tenantBoundaryChanged: false
credentialHandlingChanged: false
newWriteRisk: none # none | medium | high
promptInjectionSurface: [] # new vendor-sourced content that flows back to the model
mitigations: [] # e.g. output schema, response minimizer, hostile-content test
```

## Test plan

- [ ] `npm run verify` passes (typecheck, lint, test, catalogue generation)
- [ ] `npm run build` passes
- [ ] New/changed tools have contract tests
- [ ] New/changed write tools have write-safety tests (dry-run required, token reuse
      rejected, risk-appropriate approval)
- [ ] `tests/contract/registry-invariants.test.ts` still passes
- [ ] `READ_ONLY=true` still removes any new write tool from the advertised surface
