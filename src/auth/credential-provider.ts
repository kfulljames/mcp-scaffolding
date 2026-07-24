import type { ResolvedTenant } from "./tenant-resolver.js";

/**
 * Vendor API credentials for one tenant. Never logged, never included in a
 * tool response, never accepted as a plaintext argument from a client
 * request — see docs/SECURITY.md "Secrets management".
 */
export type VendorCredentials = Record<string, string>;

export class CredentialResolutionError extends Error {
  constructor(tenant: string, vendor: string, cause?: unknown) {
    super(`Failed to resolve credentials for tenant "${tenant}", vendor "${vendor}"`, {
      cause,
    });
    this.name = "CredentialResolutionError";
  }
}

/**
 * Abstracts *how* vendor credentials are retrieved so Key Vault, Secrets
 * Manager, HashiCorp Vault, local dev env vars, and delegated OAuth token
 * exchange all implement the same interface without a single tool ever
 * knowing which one is in play.
 *
 * The gateway/multi-tenant pattern of accepting raw vendor keys as
 * per-request headers (`X-Vendor-Api-Key`, etc.) is explicitly NOT this
 * interface's job — that pattern is fine for passing trusted *tenant and
 * identity assertions*, but vendor secrets are always resolved server-side,
 * never accepted as long-lived plaintext from a client. See
 * MCP-SCAFFOLD-REFERENCE.md, "Auth & Security".
 */
export interface CredentialProvider {
  getCredentials(tenant: ResolvedTenant, vendor: string): Promise<VendorCredentials>;
}

/**
 * DEV/LOCAL ONLY. Reads `${VENDOR}_API_KEY` (vendor name uppercased) from
 * process.env for a single tenant. Every production deployment must supply
 * a real CredentialProvider (Key Vault, Secrets Manager, ...) — this
 * implementation intentionally has no tenant-scoping story beyond "there
 * is exactly one tenant," and ships only so `npm run dev` works out of the
 * box. See docs/AUTHENTICATION.md.
 */
export class EnvCredentialProvider implements CredentialProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  getCredentials(tenant: ResolvedTenant, vendor: string): Promise<VendorCredentials> {
    const key = `${vendor.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
    const value = this.env[key];
    if (!value) {
      return Promise.reject(
        new CredentialResolutionError(
          tenant.tenantId,
          vendor,
          new Error(`Environment variable ${key} is not set`),
        ),
      );
    }
    return Promise.resolve({ apiKey: value });
  }
}

/**
 * Wraps any CredentialProvider with a short-lived, strictly tenant-scoped
 * cache. Prevents two things: hammering the secret store on every tool
 * call, and — the failure mode the tenant-isolation test suite checks for
 * — credential bleed between concurrent requests for different tenants.
 * The cache key always includes tenantId; there is no code path that can
 * return tenant A's cached credentials for tenant B.
 */
export class CachingCredentialProvider implements CredentialProvider {
  private readonly cache = new Map<
    string,
    { value: VendorCredentials; expiresAt: number }
  >();

  constructor(
    private readonly delegate: CredentialProvider,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async getCredentials(
    tenant: ResolvedTenant,
    vendor: string,
  ): Promise<VendorCredentials> {
    const key = `${tenant.tenantId}::${vendor}`;
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }
    const value = await this.delegate.getCredentials(tenant, vendor);
    this.cache.set(key, { value, expiresAt: now + this.ttlMs });
    return value;
  }
}
