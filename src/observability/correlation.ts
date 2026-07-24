import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  requestId: string;
  correlationId: string;
  tenantId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function generateId(): string {
  return randomUUID();
}

/**
 * Runs `fn` with a RequestContext bound for the duration of the call
 * (including everything awaited inside it) so the logger can attach
 * requestId/correlationId/tenantId to every log line without every call
 * site threading them through explicitly. Bound once per inbound MCP
 * request, in src/server/create-server.ts.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}
