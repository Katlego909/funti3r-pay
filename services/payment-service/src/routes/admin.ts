/**
 * The platform admin console's money routes (mounted at /admin behind requireRole('admin'); the gateway checks the
 * same role first). Read-only views live in lib/adminViews.ts. The one action here, reconciling escrows against the
 * chain, only ever brings the database in line with the contract and is audited. Admins never move anyone's money.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Router as RouterType } from 'express';
import { query } from '@funti3r/database';
import { isUuid, NotFoundError } from '@funti3r/shared-utils';
import { accountMoney, listAudit, listCashouts, listEscrows, listPayments, opsOverview, type AdminViewDeps } from '../lib/adminViews.js';
import { getAccountBalance, spendableXlm, sponsorPublicKey } from '../lib/stellar.js';
import { contractState } from '../lib/escrow.js';
import { reconcileEscrows } from '../lib/escrowReconcile.js';
import { audit } from '../lib/audit.js';

const router: RouterType = Router();

const deps: AdminViewDeps = {
  query,
  balances: async (publicKey) => {
    try {
      return await getAccountBalance(publicKey);
    } catch (err: any) {
      if (err?.response?.status === 404) return []; // not on chain yet: nothing held
      throw err;
    }
  },
  sponsor: async () => {
    const publicKey = sponsorPublicKey();
    return publicKey ? { publicKey, spendableXlm: await spendableXlm(publicKey) } : null;
  },
  contract: contractState,
};

/** Wraps a handler so a thrown error reaches the service's error handler. */
const handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

router.get('/money/:userId', handle(async (req, res) => {
  if (!isUuid(req.params.userId)) throw new NotFoundError('Account');
  const money = await accountMoney(req.params.userId, deps);
  if (!money) throw new NotFoundError('Account');
  res.json(money);
}));

router.get('/payments', handle(async (req, res) => { res.json(await listPayments(req.query as never, deps)); }));
router.get('/escrows', handle(async (req, res) => { res.json(await listEscrows(req.query as never, deps)); }));
router.get('/cashouts', handle(async (req, res) => { res.json(await listCashouts(req.query as never, deps)); }));
router.get('/ops', handle(async (_req, res) => { res.json(await opsOverview(deps)); }));
router.get('/audit', handle(async (req, res) => { res.json(await listAudit(req.query as never, deps)); }));

/**
 * Compares every active escrow with the contract. `repair: false` is a dry run that only reports the drift; otherwise
 * the database is brought in line with the chain (never the other way round). Repairs are audited.
 */
router.post('/ops/reconcile-escrows', handle(async (req, res) => {
  const repair = (req.body as { repair?: unknown } | undefined)?.repair === true;
  const report = await reconcileEscrows({ repair });
  if (repair) {
    await audit({
      actorId: req.headers['x-user-id'] as string, actorRole: 'admin', action: 'escrow.reconciled', entityType: 'escrow',
      entityId: 'all', detail: { checked: report.checked, repaired: report.repaired, unreadable: report.unreadable },
    });
  }
  res.json({ repair, ...report });
}));

export default router;
