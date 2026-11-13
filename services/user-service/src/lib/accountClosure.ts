/**
 * Self-service account closure (POPIA / NDPA / Kenya DPA right to erasure), balanced against AML record-keeping.
 *
 * Closing wipes what identifies the person: name, phone, email, KYC submission, passkeys,
 * notifications and pending invites. It destroys the custodial Stellar key. The records the law requires us to keep
 * stay: payments, escrows, cash-outs, KYC decisions and sanctions results, now tied to an anonymous user row.
 *
 * Because the key is destroyed, closing is refused while anything could still be lost: money in the wallet, open
 * escrows, unsettled payments or cash-outs, active payroll (payment-service decides those), or a company the user owns
 * that still has other members (ownership cannot be transferred yet).
 */

interface Rows { rows: any[] }
type Query = (sql: string, params?: unknown[]) => Promise<Rows>;

export interface ClosureDeps {
  query: Query;
  /** Runs `fn` in one database transaction. */
  transaction: <T>(fn: (client: { query: Query }) => Promise<T>) => Promise<T>;
  /** payment-service's blockers for this user (GET /wallets/me/closure-check). Throws if it cannot answer. */
  paymentBlockers: () => Promise<string[]>;
}

export async function closureBlockers(userId: string, deps: ClosureDeps): Promise<string[]> {
  const members = await deps.query(
    `SELECT COUNT(*) AS n FROM enterprise_members other
       JOIN enterprise_members me ON me.enterprise_id = other.enterprise_id
      WHERE me.user_id = $1 AND me.status = 'active' AND me.company_role = 'owner'
        AND other.status = 'active' AND other.user_id <> $1`,
    [userId],
  );
  const others = Number(members.rows[0]?.n ?? 0);
  const blockers = others > 0
    ? [`Your company has ${others} other member(s). Remove them first; ownership cannot be transferred yet.`]
    : [];
  return [...blockers, ...(await deps.paymentBlockers())];
}

export type CloseResult = { closed: true } | { closed: false; blockers: string[] };

export async function closeAccount(
  userId: string,
  actorRole: string,
  requestId: string | undefined,
  deps: ClosureDeps,
): Promise<CloseResult> {
  // Checked before the transaction: the payment-service answer reads Horizon, which must not hold row locks open.
  // Once the row says 'closed', payment-service stops treating the user as a payee, so nothing new can arrive after.
  const blockers = await closureBlockers(userId, deps);
  if (blockers.length > 0) return { closed: false, blockers };

  await deps.transaction(async (client) => {
    const user = (await client.query('SELECT email, status FROM users WHERE id = $1 FOR UPDATE', [userId])).rows[0];
    if (!user || user.status === 'closed') return;
    const email: string = user.email;

    await client.query(
      `UPDATE users
          SET status = 'closed', email = 'closed-' || id || '@closed.invalid',
              first_name = NULL, last_name = NULL, phone = NULL, stellar_secret_key = NULL, updated_at = NOW()
        WHERE id = $1`,
      [userId],
    );
    await client.query('DELETE FROM user_credentials WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
    await client.query(`UPDATE kyc_records SET data = NULL, updated_at = NOW() WHERE user_id = $1`, [userId]);
    await client.query(
      `UPDATE wallets SET encrypted_secret = NULL, encryption_iv = NULL, encryption_tag = NULL, encryption_salt = NULL,
              verification_challenge = NULL, verification_signature = NULL, updated_at = NOW()
        WHERE user_id = $1`,
      [userId],
    );
    await client.query(`UPDATE enterprise_workers SET status = 'removed' WHERE worker_id = $1`, [userId]);
    await client.query(`UPDATE enterprise_members SET status = 'removed', updated_at = NOW() WHERE user_id = $1`, [userId]);
    await client.query(`DELETE FROM worker_invites WHERE LOWER(email) = LOWER($1) AND status = 'pending'`, [email]);
    await client.query(`DELETE FROM enterprise_member_invites WHERE LOWER(email) = LOWER($1) AND status = 'pending'`, [email]);
    await client.query(
      `INSERT INTO audit_events (actor_id, actor_role, action, entity_type, entity_id, detail, request_id)
       VALUES ($1::uuid, $2, 'account_closed', 'user', $1::text, NULL, $3)`,
      [userId, actorRole, requestId ?? null],
    );
  });
  return { closed: true };
}
