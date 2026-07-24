export interface HealthStatus {
  healthy: boolean;
  /** Short, sanitized diagnostic — never a raw vendor error body or stack trace. */
  detail?: string;
  checkedAt: string;
}
