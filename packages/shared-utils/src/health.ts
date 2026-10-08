interface Res {
  status(code: number): { json(body: unknown): unknown };
}
interface App {
  get(path: string, handler: (req: unknown, res: Res) => unknown): unknown;
}

export interface HealthCheck {
  /** A failing critical check takes the instance out of rotation (503). A non-critical one is reported but does not. */
  critical: boolean;
  run: () => Promise<void>;
}

const CHECK_TIMEOUT_MS = 3000;

async function timed(run: () => Promise<void>) {
  const started = Date.now();
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), CHECK_TIMEOUT_MS).unref()),
    ]);
    return { ok: true as const, ms: Date.now() - started };
  } catch (err) {
    return { ok: false as const, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * `/health/live`: the process is up and answering (cheap, for restarts). `/health/ready`: its dependencies work, so
 * it can take traffic; reports each check with its latency and returns 503 when a critical one fails. A third-party
 * outage (say Horizon) is a non-critical check: it shows on the dashboard and in alerts without making the service
 * refuse the requests that do not need it. `/health` stays as the plain liveness answer the compose healthchecks use.
 */
export function registerHealth(app: App, service: string, checks: Record<string, HealthCheck> = {}): void {
  const live = (_req: unknown, res: Res) => { res.status(200).json({ status: 'healthy', service, uptime: process.uptime() }); };
  app.get('/health', live);
  app.get('/health/live', live);

  app.get('/health/ready', async (_req, res) => {
    const names = Object.keys(checks);
    const results = await Promise.all(names.map((n) => timed(checks[n].run)));
    const report = Object.fromEntries(names.map((n, i) => [n, { critical: checks[n].critical, ...results[i] }]));
    const ready = names.every((n, i) => results[i].ok || !checks[n].critical);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable', service, checks: report });
  });
}
