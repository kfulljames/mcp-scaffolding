/**
 * Minimal metrics surface. Kept deliberately small (counters + histograms)
 * so swapping in a real backend (Prometheus client, OpenTelemetry, Azure
 * Monitor) is a one-file change — nothing in src/server or src/tools
 * depends on a specific metrics library.
 */
export interface Metrics {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, valueMs: number, labels?: Record<string, string>): void;
}

export class NoopMetrics implements Metrics {
  incrementCounter(_name: string, _labels?: Record<string, string>): void {
    /* no-op default; wire a real backend before production use */
  }
  recordHistogram(
    _name: string,
    _valueMs: number,
    _labels?: Record<string, string>,
  ): void {
    /* no-op default; wire a real backend before production use */
  }
}

/** In-memory metrics for tests and local dev — not a production backend. */
export class InMemoryMetrics implements Metrics {
  readonly counters = new Map<string, number>();
  readonly histograms = new Map<string, number[]>();

  private key(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return name;
    const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return `${name}{${sorted.map(([k, v]) => `${k}=${v}`).join(",")}}`;
  }

  incrementCounter(name: string, labels?: Record<string, string>): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }

  recordHistogram(name: string, valueMs: number, labels?: Record<string, string>): void {
    const key = this.key(name, labels);
    const values = this.histograms.get(key) ?? [];
    values.push(valueMs);
    this.histograms.set(key, values);
  }
}
