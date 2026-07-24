// Reference Azure Container Apps deployment for an MCP server built from this
// scaffold. Adapt names/SKUs to your environment — this is a starting point,
// not a drop-in for every deployment. See docs/DEPLOYMENT.md.
@description('Name prefix for all resources.')
param namePrefix string = 'mcp-server'

@description('Azure region.')
param location string = resourceGroup().location

@description('Container image, e.g. myregistry.azurecr.io/mcp-server:<git-sha>. Never :latest — see docs/DEPLOYMENT.md.')
param containerImage string

@description('Key Vault URI backing CredentialProvider — see src/auth/credential-provider.ts.')
param keyVaultUri string

@minValue(0)
@description('Minimum replicas. 0 is fine for low-traffic internal tools; use >=1 for latency-sensitive multi-tenant HTTP traffic to avoid cold starts. See docs/DEPLOYMENT.md.')
param minReplicas int = 1

@maxValue(10)
param maxReplicas int = 5

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-identity'
  location: location
}

resource environment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {}
}

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: namePrefix
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
      }
      // Vendor credentials and API keys are resolved at runtime through Key Vault
      // via CredentialProvider (src/auth/credential-provider.ts) — do NOT put
      // secret values in Container Apps' own secret store for anything beyond
      // local experimentation. See docs/SECURITY.md.
      secrets: []
    }
    template: {
      containers: [
        {
          name: namePrefix
          image: containerImage
          env: [
            { name: 'TRANSPORT', value: 'http' }
            { name: 'PORT', value: '3000' }
            { name: 'AUTH_MODE', value: 'entra' }
            { name: 'READ_ONLY', value: 'true' }
            { name: 'KEY_VAULT_URI', value: keyVaultUri }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health/live', port: 3000 }
              periodSeconds: 15
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health/ready', port: 3000 }
              periodSeconds: 10
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
output identityPrincipalId string = identity.properties.principalId
