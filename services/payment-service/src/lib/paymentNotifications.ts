import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('PaymentNotifications');

/**
 * Tells both sides a payout landed (or is waiting to be claimed). Best-effort: a notification failure never changes
 * the payment's outcome. Shared by the payout path and the watchdog that settles submissions after the fact.
 */
export async function notifyPaymentSettled(p: {
  paymentId: string; enterpriseId: string; workerId: string; workerEmail: string;
  amount: number | string; asset: string; status: 'completed' | 'pending_claim'; claimableXlm?: string | null;
}): Promise<void> {
  const insert = (userId: string, type: string, title: string, body: string) => query(
    `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id)
     VALUES ($1, $2, $3, $4, 'payment', $5)`,
    [userId, type, title, body, p.paymentId],
  );
  try {
    if (p.status === 'completed') {
      await Promise.all([
        insert(p.enterpriseId, 'payment_completed', 'Payment sent', `Payment of ${p.amount} ${p.asset} to ${p.workerEmail} was settled.`),
        insert(p.workerId, 'payment_received', 'Payment received', `You received ${p.amount} ${p.asset} from your employer.`),
      ]);
    } else {
      await Promise.all([
        insert(p.enterpriseId, 'payment_pending_claim', 'Payment pending claim', `Payment to ${p.workerEmail} is pending — they need to set up a trustline to receive ${p.asset}.`),
        insert(p.workerId, 'payment_pending_claim', 'Payment waiting for you',
          p.claimableXlm ? `A payment of ${p.claimableXlm} XLM is held for you. Set up your wallet to claim it.` : 'A payment is held for you. Set up your wallet to claim it.'),
      ]);
    }
  } catch (notifErr) {
    logger.warn('Failed to emit payment notification', { paymentId: p.paymentId, error: String(notifErr) });
  }
}
