/**
 * The identity of whoever is calling the server, established by the
 * transport's auth layer (API key lookup, validated Entra ID token, etc.)
 * before any tool runs. Tools never see anything weaker than this — there
 * is no "anonymous" tool call path in this scaffold.
 */
export interface AuthenticatedPrincipal {
  /** Stable, unique identifier for the caller (user, service principal, API key ID). */
  subjectId: string;
  email?: string;
  /** The organization/workspace the principal belongs to — NOT the tenant being acted on. */
  organizationId: string;
  roles: string[];
  /** Raw claims from the token/credential, for policies that need more than roles. */
  claims: Record<string, unknown>;
}
