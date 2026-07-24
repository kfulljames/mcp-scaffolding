import { loadEnvironment } from "./config/environment.js";
import { createLogger } from "./observability/logger.js";
import { StructuredAuditLogger } from "./observability/audit-log.js";
import { NoopMetrics } from "./observability/metrics.js";
import { ToolRegistry } from "./server/tool-registry.js";
import { SingleTenantResolver } from "./auth/tenant-resolver.js";
import {
  CachingCredentialProvider,
  EnvCredentialProvider,
} from "./auth/credential-provider.js";
import { RoleBasedAuthorizationPolicy } from "./auth/authorization-policy.js";
import {
  NoAuthAuthenticator,
  ApiKeyAuthenticator,
  EntraAuthenticator,
} from "./auth/http-authenticator.js";
import type { HttpAuthenticator } from "./auth/http-authenticator.js";
import { InMemoryOperationTokenStore } from "./safety/operation-token.js";
import { InMemoryApprovalService } from "./safety/approval-service.js";
import { startStdioServer, createHttpApp } from "./server/transports.js";
import type { ServerDependencies } from "./server/create-server.js";
import type { AuthenticatedPrincipal } from "./auth/authenticated-principal.js";

import { searchOpenHighPriorityTickets } from "../examples/read-tool.js";
import { closeTicket } from "../examples/write-tool.js";
import { listTickets } from "../examples/paginated-tool.js";
import {
  MockVendorClient,
  type MockVendorCapableClient,
} from "../examples/vendor/mock-vendor-client.js";

/**
 * Demo entrypoint. This wires the *example* tools (examples/) against the
 * *example* in-memory vendor client (examples/vendor/) so `npm run dev`
 * and `npm start` work out of the box. A real server built from this
 * template replaces the three imports above with its own src/tools/read/,
 * src/tools/write/, and src/vendor/ — see docs/ADDING-A-TOOL.md — and this
 * file changes only to import those instead.
 */
async function main(): Promise<void> {
  const config = loadEnvironment();
  const logger = createLogger({
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
    name: config.SERVER_NAME,
  });

  const registry = new ToolRegistry().registerAll([
    searchOpenHighPriorityTickets,
    closeTicket,
    listTickets,
  ]);

  // Local dev default: a single demo tenant. A multi-tenant deployment
  // supplies a real TenantResolver here instead — see docs/AUTHENTICATION.md.
  const tenantResolver = new SingleTenantResolver({
    tenantId: "tenant-a",
    displayName: "Example Tenant A",
  });

  const credentialProvider = new CachingCredentialProvider(new EnvCredentialProvider());

  const authorizationPolicy = new RoleBasedAuthorizationPolicy({
    admin: ["tickets.read", "tickets.write"],
    agent: ["tickets.read"],
  });

  const deps: ServerDependencies<MockVendorCapableClient> = {
    config,
    registry,
    tenantResolver,
    credentialProvider,
    authorizationPolicy,
    vendorName: "mockvendor",
    createVendorClient: (credentials, tenant) =>
      new MockVendorClient(credentials, tenant),
    logger,
    auditLogger: new StructuredAuditLogger(logger),
    metrics: new NoopMetrics(),
    tokenStore: new InMemoryOperationTokenStore(),
    approvalService: new InMemoryApprovalService(),
  };

  if (config.TRANSPORT === "stdio") {
    const principal: AuthenticatedPrincipal = {
      subjectId: "local-dev",
      organizationId: "local",
      roles: ["admin"],
      claims: {},
    };
    await startStdioServer(principal, deps);
    logger.info(
      { transport: "stdio", presets: config.MCP_PRESETS, readOnly: config.READ_ONLY },
      "server started",
    );
    return;
  }

  const authenticator: HttpAuthenticator =
    config.AUTH_MODE === "api-key"
      ? new ApiKeyAuthenticator(config.API_KEYS ?? "")
      : config.AUTH_MODE === "entra"
        ? new EntraAuthenticator()
        : new NoAuthAuthenticator({
            subjectId: "local-dev",
            organizationId: "local",
            roles: ["admin"],
            claims: {},
          });

  const app = createHttpApp(deps, authenticator, logger);
  app.listen(config.PORT, () => {
    logger.info(
      {
        transport: "http",
        port: config.PORT,
        presets: config.MCP_PRESETS,
        readOnly: config.READ_ONLY,
      },
      "server started",
    );
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console -- the structured logger itself may not have constructed successfully yet
  console.error("Fatal error during startup:", error);
  process.exitCode = 1;
});
