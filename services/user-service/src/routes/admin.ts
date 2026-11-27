/**
 * The platform admin console's account and company routes (mounted at /admin behind requireRole('admin'); the gateway
 * checks the same role first). The logic lives in lib/adminDirectory.ts.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import { audit, query } from '@funti3r/database';
import { isUuid, NotFoundError, ValidationError } from '@funti3r/shared-utils';
import {
  accountDetail, companyDetail, listAccounts, listCompanies, searchDirectory, setAccountStatus,
} from '../lib/adminDirectory.js';
import { metrics } from '../metrics.js';

const router: RouterType = Router();
const auditFailures = metrics.counter('audit_write_failures_total', 'Audit events that could not be written');
const deps = { query, audit: (e: Parameters<typeof audit>[0]) => audit(e, { onFailure: () => auditFailures.inc() }) };

/** An id from the URL, checked before it reaches a uuid column (a malformed one is a 404 here, not a database error). */
function idParam(req: Request, what: string): string {
  if (!isUuid(req.params.id)) throw new NotFoundError(what);
  return req.params.id;
}

router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await searchDirectory(typeof req.query.q === 'string' ? req.query.q : '', deps));
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listAccounts(req.query as never, deps));
  } catch (err) {
    next(err);
  }
});

router.get('/companies', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listCompanies(req.query as never, deps));
  } catch (err) {
    next(err);
  }
});

router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await accountDetail(idParam(req, 'Account'), deps);
    if (!detail) throw new NotFoundError('Account');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

router.get('/companies/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const detail = await companyDetail(idParam(req, 'Company'), deps);
    if (!detail) throw new NotFoundError('Company');
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

for (const [path, to] of [['suspend', 'suspended'], ['reactivate', 'active']] as const) {
  router.post(`/users/:id/${path}`, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reason = (req.body as { reason?: unknown } | undefined)?.reason;
      if (typeof reason !== 'string') throw new ValidationError('A reason is required');
      res.json(await setAccountStatus(idParam(req, 'Account'), to, reason, req.headers['x-user-id'] as string, deps));
    } catch (err) {
      next(err);
    }
  });
}

export default router;
