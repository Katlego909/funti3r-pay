import type { ZodTypeAny, z } from 'zod';

interface Req { body?: unknown }
interface Res { status(code: number): { json(body: unknown): unknown } }

/**
 * Express middleware: the request body must match the schema, or the request is refused with a 400 before any
 * handler or database sees it. On success `req.body` is replaced with the parsed value (unknown keys dropped), so
 * handlers read typed, bounded data: UUIDs that really are UUIDs, strings with a length cap, arrays with a size cap.
 * `error` is one readable string for the UI; `issues` lists each field.
 */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Req, res: Res, next: () => void): void => {
    const body = parseBody(schema, req.body, res);
    if (body === undefined) return;
    req.body = body;
    next();
  };
}

/**
 * The same check for a handler that must run its own permission checks first (so a caller who may not do this at
 * all still gets a 403, not a 400): returns the parsed body, or replies 400 and returns undefined.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown, res: Res): z.infer<S> | undefined {
  const parsed = schema.safeParse(body ?? {});
  if (parsed.success) return parsed.data as z.infer<S>;
  const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  const first = issues[0];
  res.status(400).json({
    error: `Invalid request${first ? `: ${first.path ? `${first.path} — ` : ''}${first.message}` : ''}`,
    issues,
  });
  return undefined;
}
