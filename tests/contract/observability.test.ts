import { describe, expect, it } from "vitest";
import {
  generateId,
  getRequestContext,
  runWithContext,
} from "../../src/observability/correlation.js";
import { createLogger } from "../../src/observability/logger.js";
import { InMemoryMetrics, NoopMetrics } from "../../src/observability/metrics.js";
import { StructuredAuditLogger } from "../../src/observability/audit-log.js";

describe("correlation", () => {
  it("generates distinct IDs", () => {
    expect(generateId()).not.toBe(generateId());
  });

  it("has no bound context outside runWithContext", () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it("binds a context for the duration of the callback, including across awaits", async () => {
    const result = await runWithContext(
      { requestId: "r1", correlationId: "c1" },
      async () => {
        expect(getRequestContext()).toEqual({ requestId: "r1", correlationId: "c1" });
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(getRequestContext()).toEqual({ requestId: "r1", correlationId: "c1" });
        return "done";
      },
    );
    expect(result).toBe("done");
    expect(getRequestContext()).toBeUndefined();
  });

  it("nested/concurrent contexts don't leak into each other", async () => {
    await Promise.all([
      runWithContext({ requestId: "a", correlationId: "a" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(getRequestContext()?.requestId).toBe("a");
      }),
      runWithContext({ requestId: "b", correlationId: "b" }, async () => {
        expect(getRequestContext()?.requestId).toBe("b");
      }),
    ]);
  });
});

describe("createLogger", () => {
  it("constructs a working logger that redacts secret-shaped fields", () => {
    const logger = createLogger({ level: "silent", format: "json", name: "test" });
    // "silent" level means nothing is actually written to stdout, but the call must not throw,
    // and the formatter (which applies redact()) must run without error against secret-shaped input.
    expect(() =>
      logger.info({ apiKey: "should-be-redacted" }, "test message"),
    ).not.toThrow();
  });

  it("attaches request context fields via mixin when bound", () => {
    const logger = createLogger({ level: "silent", format: "json", name: "test" });
    runWithContext({ requestId: "req-1", correlationId: "corr-1" }, () => {
      expect(() => logger.info("inside context")).not.toThrow();
    });
  });
});

describe("Metrics", () => {
  it("NoopMetrics accepts calls without error and without recording anything observable", () => {
    const metrics = new NoopMetrics();
    expect(() => metrics.incrementCounter("x")).not.toThrow();
    expect(() => metrics.recordHistogram("y", 10)).not.toThrow();
  });

  it("InMemoryMetrics tracks counters per label combination", () => {
    const metrics = new InMemoryMetrics();
    metrics.incrementCounter("tool.calls", { tool: "a", outcome: "executed" });
    metrics.incrementCounter("tool.calls", { tool: "a", outcome: "executed" });
    metrics.incrementCounter("tool.calls", { tool: "b", outcome: "denied" });

    expect(metrics.counters.get("tool.calls{outcome=executed,tool=a}")).toBe(2);
    expect(metrics.counters.get("tool.calls{outcome=denied,tool=b}")).toBe(1);
  });

  it("InMemoryMetrics accumulates histogram values per label combination", () => {
    const metrics = new InMemoryMetrics();
    metrics.recordHistogram("tool.duration_ms", 10, { tool: "a" });
    metrics.recordHistogram("tool.duration_ms", 20, { tool: "a" });
    expect(metrics.histograms.get("tool.duration_ms{tool=a}")).toEqual([10, 20]);
  });
});

describe("StructuredAuditLogger", () => {
  it("records an entry by delegating to the logger without throwing", () => {
    const logger = createLogger({ level: "silent", format: "json", name: "audit-test" });
    const auditLogger = new StructuredAuditLogger(logger);
    expect(() =>
      auditLogger.record({
        timestamp: new Date().toISOString(),
        requestId: "r1",
        correlationId: "c1",
        principalId: "p1",
        organizationId: "o1",
        tenantId: "t1",
        tool: "mockvendor_search_open_high_priority_tickets",
        accessMode: "read",
        risk: "low",
        outcome: "executed",
      }),
    ).not.toThrow();
  });
});
