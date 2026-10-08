import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

type Labels = Record<string, string | number>;

/** The few operations services use, named here so services need not depend on prom-client's own types. */
export interface MetricCounter {
  inc(labels?: Labels, value?: number): void;
}
export interface MetricGauge {
  set(labels: Labels, value: number): void;
  set(value: number): void;
  inc(labels?: Labels, value?: number): void;
  dec(labels?: Labels, value?: number): void;
}
export interface MetricHistogram {
  observe(labels: Labels, value: number): void;
  observe(value: number): void;
  startTimer(labels?: Labels): (labels?: Labels) => number;
}

interface MetricsResponse {
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
  status(code: number): { end(body?: string): unknown };
}

export interface ServiceMetrics {
  /** Pass to requestContext(): records every finished request. */
  observeRequest(info: { method: string; route: string; status: number; seconds: number }): void;
  /** `app.get('/metrics', metrics.handler)` */
  handler(req: unknown, res: MetricsResponse): Promise<void>;
  counter(name: string, help: string, labelNames?: readonly string[]): MetricCounter;
  gauge(name: string, help: string, labelNames?: readonly string[]): MetricGauge;
  histogram(name: string, help: string, labelNames?: readonly string[], buckets?: number[]): MetricHistogram;
}

/**
 * Prometheus metrics for one service: process basics (CPU, memory, event-loop lag), HTTP request volume and latency
 * by route pattern and status, plus whatever counters, gauges and histograms the service registers for its own work
 * (payouts settled, jobs run…). Each service exposes them at GET /metrics on its internal address; the gateway does not
 * proxy that path, so they are reachable by the monitoring stack inside the network and by nobody outside it.
 */
export function createMetrics(service: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route pattern and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  return {
    observeRequest: (info) => {
      httpDuration.observe({ method: info.method, route: info.route, status: String(info.status) }, info.seconds);
    },

    handler: async (_req, res) => {
      try {
        res.setHeader('Content-Type', registry.contentType);
        res.end(await registry.metrics());
      } catch (err) {
        res.status(500).end(String(err));
      }
    },

    counter: (name, help, labelNames = []) => new Counter({ name, help, labelNames: [...labelNames], registers: [registry] }) as unknown as MetricCounter,
    gauge: (name, help, labelNames = []) => new Gauge({ name, help, labelNames: [...labelNames], registers: [registry] }) as unknown as MetricGauge,
    histogram: (name, help, labelNames = [], buckets) =>
      new Histogram({ name, help, labelNames: [...labelNames], buckets, registers: [registry] }) as unknown as MetricHistogram,
  };
}
