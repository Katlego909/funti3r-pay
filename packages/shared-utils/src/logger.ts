import { AsyncLocalStorage } from 'node:async_hooks';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isLogLevel(value: string): value is LogLevel {
  return value in levels;
}

const envLevel = process.env.LOG_LEVEL;
// An unrecognized LOG_LEVEL (typo, stray whitespace) must not silently
// suppress every log line — fall back to 'info' instead.
const LOG_LEVEL: LogLevel = envLevel && isLogLevel(envLevel) ? envLevel : 'info';

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[LOG_LEVEL];
}

// ── Request context ───────────────────────────────────────────────────────────
// Whatever code runs while a request is being handled can log without passing ids around: every line it writes
// carries the request id (the same id the gateway minted, so one request is traceable across services) and the
// signed-in user.

export interface LogContext {
  requestId?: string;
  userId?: string;
  role?: string;
}

const store = new AsyncLocalStorage<LogContext>();

export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return store.run({ ...ctx }, fn);
}

export function getLogContext(): LogContext | undefined {
  return store.getStore();
}

// ── Redaction ─────────────────────────────────────────────────────────────────
// Logs are copied to places with weaker access than the database. Anything whose key names a credential or personal
// identifier is replaced before it is written, however deep it sits in the object.

const SENSITIVE_KEY = /secret|token|password|passcode|authorization|cookie|api[-_]?key|private|mnemonic|seed|signature|id_?number|account_?number|bank_?account|routing|tax|date_?of_?birth|\bdob\b|phone/i;
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

// ── Output ────────────────────────────────────────────────────────────────────
// JSON lines in production (what log collectors parse and alert on); readable text while developing.
// LOG_FORMAT=json|text overrides either way.

const asJson = (): boolean => (process.env.LOG_FORMAT ?? (process.env.NODE_ENV === 'production' ? 'json' : 'text')) === 'json';

function formatMessage(level: LogLevel, context: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const ctx = store.getStore();
  const safe = data === undefined ? undefined : redact(data);

  if (asJson()) {
    return JSON.stringify({
      ts: timestamp,
      level,
      service: context,
      msg: message,
      ...(ctx?.requestId && { requestId: ctx.requestId }),
      ...(ctx?.userId && { userId: ctx.userId }),
      ...(ctx?.role && { role: ctx.role }),
      ...(safe !== undefined && { data: safe }),
    });
  }
  const dataStr = safe ? ` ${JSON.stringify(safe)}` : '';
  const reqStr = ctx?.requestId ? ` [req ${ctx.requestId.slice(0, 8)}${ctx.userId ? ` user ${ctx.userId.slice(0, 8)}` : ''}]` : '';
  return `[${timestamp}] [${level.toUpperCase()}] [${context}]${reqStr}${dataStr} ${message}`;
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: unknown) => {
      if (shouldLog('debug')) console.log(formatMessage('debug', context, message, data));
    },
    info: (message: string, data?: unknown) => {
      if (shouldLog('info')) console.log(formatMessage('info', context, message, data));
    },
    warn: (message: string, data?: unknown) => {
      if (shouldLog('warn')) console.warn(formatMessage('warn', context, message, data));
    },
    error: (message: string, data?: unknown) => {
      if (shouldLog('error')) console.error(formatMessage('error', context, message, data));
    },
  };
}
