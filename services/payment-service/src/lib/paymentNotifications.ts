import { notify } from '@funti3r/database';

/**
 * Tells both sides a payout landed (or is waiting to be claimed). Best-effort: a notification failure never changes
 * the payment's outcome. Shared by the payout path and the watchdog that settles submissions after the fact.
 */
export async function notifyPaymentSettled(p: {
  paymentId: string; enterpriseId: string; workerId: string; workerEmail: string;
  amount: number | string; asset: string; status: 'completed' | 'pending_claim'; claimableXlm?: string | null;
}): Promise<void> {
  const send = (userId: string, type: string, title: string, body: string) =>
    notify({ userId, type, title, body, entityType: 'payment', entityId: p.paymentId });
  if (p.status === 'completed') {
    await Promise.all([
      send(p.enterpriseId, 'payment_completed', 'Payment sent', `Payment of ${p.amount} ${p.asset} to ${p.workerEmail} was settled.`),
      send(p.workerId, 'payment_received', 'Payment received', `You received ${p.amount} ${p.asset} from your employer.`),
    ]);
  } else {
    await Promise.all([
      send(p.enterpriseId, 'payment_pending_claim', 'Payment pending claim', `Payment to ${p.workerEmail} is pending — they need to set up a trustline to receive ${p.asset}.`),
      send(p.workerId, 'payment_pending_claim', 'Payment waiting for you',
        p.claimableXlm ? `A payment of ${p.claimableXlm} XLM is held for you. Set up your wallet to claim it.` : 'A payment is held for you. Set up your wallet to claim it.'),
    ]);
  }
}
