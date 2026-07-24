# Azure Container Apps deployment

```bash
az group create --name rg-mcp-server --location eastus

az deployment group create \
  --resource-group rg-mcp-server \
  --template-file main.bicep \
  --parameters containerImage=<registry>/<image>:<git-sha> keyVaultUri=https://<vault>.vault.azure.net/
```

## Before deploying for real

1. **Grant the managed identity Key Vault access.** `main.bicep` creates a user-assigned
   identity but does not grant it a Key Vault access policy / RBAC role — do that separately
   (`az keyvault set-policy` or an RBAC role assignment) scoped to `get`/`list` on secrets
   only. This is what `CredentialProvider` should resolve vendor credentials through in
   production (`src/auth/credential-provider.ts`).
2. **Implement `AUTH_MODE=entra` before relying on it.** The template sets `AUTH_MODE=entra`
   as the production default, but `EntraAuthenticator` is an explicit stub in this scaffold —
   see `docs/AUTHENTICATION.md`. Every request will fail authentication until you implement
   real token validation.
3. **`minReplicas`.** Defaulted to 1 to avoid cold-start latency on first request after idle
   for multi-tenant HTTP traffic. Drop to 0 only for genuinely low-traffic internal tools
   where an occasional cold start is acceptable — see `docs/DEPLOYMENT.md`.
4. **Tag by commit SHA**, never `:latest` — see `docs/DEPLOYMENT.md`'s "Rollback" section.
5. **Probes** point at `/health/live` and `/health/ready`, never `/health/vendor` — see
   `docs/DEPLOYMENT.md`'s health endpoint table for why.
