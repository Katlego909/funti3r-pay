import { getLogContext } from './logger.js';

/** An error meant for the client: its message, code and `extra` fields are sent in the response as is. */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public details?: Record<string, string[]>) {
    super(400, message, 'VALIDATION_ERROR', details && { issues: details });
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super(401, message, 'AUTHENTICATION_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied') {
    super(403, message, 'AUTHORIZATION_ERROR');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

/** A dependency (Horizon, an anchor, an FX feed) failed. `message` is what the client sees, so keep internals out of it. */
export class ExternalServiceError extends AppError {
  constructor(
    public service: string,
    message: string,
    code: string = 'EXTERNAL_SERVICE_ERROR',
    options?: { cause?: unknown }
  ) {
    super(502, message, code);
    this.name = 'ExternalServiceError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

// ── HTTP mapping ──────────────────────────────────────────────────────────────
// The one place an error becomes a response. The rule: an AppError's message was written for the client and is sent
// as is; any other error is an internal failure (a SQL error, a Horizon payload, a bug) whose message may leak
// internals, so the client gets a generic message plus the request id, and the details go to the log.

interface Logger { warn(message: string, data?: unknown): void; error(message: string, data?: unknown): void }
interface Req { method: string; path: string }
interface Res { headersSent: boolean; status(code: number): { json(body: unknown): unknown } }

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** Express error middleware. Mount it last, after every route. */
export function errorHandler(logger: Logger) {
  return (err: unknown, req: Req, res: Res, next: (err: unknown) => void) => {
    if (res.headersSent) return next(err);
    const where = { method: req.method, path: req.path };

    if (err instanceof AppError) {
      const data = { ...where, status: err.statusCode, code: err.code, cause: describeCause(err.cause) };
      if (err.statusCode >= 500) logger.error(err.message, data);
      else logger.warn(err.message, data);
      return res.status(err.statusCode).json({
        ...err.extra,
        error: err.message,
        ...(err.code && { code: err.code }),
        ...(err.statusCode >= 500 && { requestId: getLogContext()?.requestId }),
      });
    }

    // body-parser marks its own failures with a `type`; they are the client's fault, not ours.
    const type = (err as { type?: unknown } | null)?.type;
    if (type === 'entity.parse.failed') {
      logger.warn('Malformed JSON body', where);
      return res.status(400).json({ error: 'Malformed JSON body', code: 'MALFORMED_JSON' });
    }
    if (type === 'entity.too.large') {
      logger.warn('Request body too large', where);
      return res.status(413).json({ error: 'Request body too large', code: 'PAYLOAD_TOO_LARGE' });
    }

    logger.error('Unhandled error', { ...where, error: describeCause(err) });
    return res.status(500).json({ error: GENERIC_MESSAGE, code: 'INTERNAL_ERROR', requestId: getLogContext()?.requestId });
  };
}

/**
 * Logs a crash that escaped every handler, then exits so the container restarts from a clean state. Interrupted
 * payments are recovered by their idempotency keys and the batch watchdog; carrying on in an unknown state is not safe.
 */
export function installProcessHandlers(logger: Logger) {
  const crash = (kind: string) => (err: unknown) => {
    logger.error(kind, { error: describeCause(err) });
    process.exit(1);
  };
  process.on('unhandledRejection', crash('Unhandled promise rejection'));
  process.on('uncaughtException', crash('Uncaught exception'));
}

/** The logger turns an Error into name + message only; keep the stack for crashes. */
function describeCause(err: unknown) {
  if (err === undefined) return undefined;
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return String(err);
}
