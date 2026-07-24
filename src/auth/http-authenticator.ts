import type { AuthenticatedPrincipal } from "./authenticated-principal.js";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Authenticates one inbound HTTP request and returns the principal it
 * belongs to. This is the ONLY place a raw credential from a request
 * (a bearer token, an API key header) is inspected — everything downstream
 * of this operates on the resolved `AuthenticatedPrincipal`, never the raw
 * credential. See docs/AUTHENTICATION.md.
 */
export interface HttpAuthenticator {
  authenticate(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthenticatedPrincipal>;
}

/**
 * Single-tenant local dev only. The config schema (src/config/schema.ts)
 * already refuses to start with TRANSPORT=http when AUTH_MODE=none, so this
 * class is only ever reachable over stdio, where "authenticate" is a
 * formality — the process's own OS-level access control is the trust boundary.
 */
export class NoAuthAuthenticator implements HttpAuthenticator {
  constructor(private readonly principal: AuthenticatedPrincipal) {}

  authenticate(): Promise<AuthenticatedPrincipal> {
    return Promise.resolve(this.principal);
  }
}

interface ApiKeyRecord {
  subjectId: string;
  organizationId: string;
  roles: string[];
}

/**
 * Static bearer-token auth for simple deployments. Parses `API_KEYS` as
 * `key:subjectId:organizationId:role1|role2,key2:...`. This is intentionally
 * the simplest possible real auth mechanism — adequate for an internal
 * server with a handful of known callers, not a substitute for OAuth in a
 * client-facing multi-tenant deployment (use AUTH_MODE=entra there).
 *
 * Key material lives in `API_KEYS` for local/simple deployments only; a
 * production deployment should source it from the same secret store as
 * vendor credentials (see CredentialProvider) rather than a plain env var.
 */
export class ApiKeyAuthenticator implements HttpAuthenticator {
  private readonly keys = new Map<string, ApiKeyRecord>();

  constructor(rawApiKeys: string) {
    for (const entry of rawApiKeys
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [key, subjectId, organizationId, rolesRaw] = entry.split(":");
      if (!key || !subjectId || !organizationId) {
        throw new Error(
          `Malformed API_KEYS entry "${entry}" — expected key:subjectId:organizationId:role1|role2`,
        );
      }
      this.keys.set(key, {
        subjectId,
        organizationId,
        roles: rolesRaw ? rolesRaw.split("|").filter(Boolean) : [],
      });
    }
  }

  authenticate(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<AuthenticatedPrincipal> {
    const header = headers.authorization ?? headers.Authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    const match = raw?.match(/^Bearer (.+)$/i);
    if (!match?.[1]) {
      return Promise.reject(
        new AuthenticationError("Missing or malformed Authorization: Bearer header."),
      );
    }
    const record = this.keys.get(match[1]);
    if (!record) {
      return Promise.reject(new AuthenticationError("API key not recognized."));
    }
    return Promise.resolve({
      subjectId: record.subjectId,
      organizationId: record.organizationId,
      roles: record.roles,
      claims: {},
    });
  }
}

/**
 * NOT IMPLEMENTED. This is an explicit stub, not a shortcut — a fake-but-
 * plausible-looking JWT validator is more dangerous than an authenticator
 * that refuses to start, because it looks secure without being secure.
 *
 * Wiring real Entra ID / OAuth 2.1 auth means, at minimum: fetch and cache
 * the tenant's JWKS, verify the token signature and `exp`/`nbf`, verify
 * `iss` matches the expected Entra tenant, verify `aud` matches this
 * server's registered app ID, and map verified claims (`oid`, `roles`,
 * `tid`) onto AuthenticatedPrincipal. See docs/AUTHENTICATION.md for the
 * full walkthrough and MCP-SCAFFOLD-REFERENCE.md for real-world examples
 * to model this on before replacing this class.
 */
export class EntraAuthenticator implements HttpAuthenticator {
  authenticate(): Promise<AuthenticatedPrincipal> {
    return Promise.reject(
      new AuthenticationError(
        "AUTH_MODE=entra is not implemented in this template — it is a deliberate stub. " +
          "Implement real Entra ID token validation before using this mode; see docs/AUTHENTICATION.md.",
      ),
    );
  }
}
