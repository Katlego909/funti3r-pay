/**
 * One-off: fill in the anchor's payout amount + fee for cash-outs that completed
 * before payout receipts were captured (migration 017).
 *
 * The numbers come from the anchor itself (its own record of each withdrawal),
 * read with the worker's own SEP-10 session — authoritative, not reconstructed.
 * The destination is deliberately NOT backfilled: we never recorded which payout
 * details were submitted back then, and guessing from today's saved details
 * could show a worker a destination that was never used.
 *
 * Idempotent: only rows still missing the amount are touched.
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/backfill-payout-receipts.ts [--dry]
 */
import { query } from '@funti3r/database';
import { decryptFromString } from '@funti3r/shared-utils';
import { anchorGetTransaction, sep10Auth, type AnchorProtocol } from '../src/lib/anchor.js';

const dry = process.argv.includes('--dry');

interface Row {
  escrow_id: string;
  idx: number;
  description: string | null;
  anchor_tx_id: string;
  anchor_protocol: string | null;
  stellar_secret_key: string;
}

const rows = await query<Row>(
  `SELECT m.escrow_id, m.idx, m.description, m.anchor_tx_id, m.anchor_protocol, u.stellar_secret_key
     FROM escrow_milestones m
     JOIN escrows e ON e.id = m.escrow_id
     JOIN users u ON u.id = e.worker_id
    WHERE m.cashout_status = 'completed' AND m.anchor_tx_id IS NOT NULL AND m.anchor_amount_out IS NULL
    ORDER BY m.cashout_at`,
);
console.log(`${rows.rows.length} completed cash-out(s) without a recorded payout amount${dry ? ' (dry run)' : ''}\n`);

const domain = process.env.ANCHOR_HOME_DOMAIN ?? null;
let updated = 0;
let skipped = 0;

for (const r of rows.rows) {
  const label = `${r.description ?? 'milestone'} (${r.anchor_tx_id.slice(0, 8)}…)`;
  try {
    const jwt = await sep10Auth(decryptFromString(r.stellar_secret_key));
    const protocol: AnchorProtocol = r.anchor_protocol === 'sep24' ? 'sep24' : 'sep6';
    const t = await anchorGetTransaction(protocol, jwt, r.anchor_tx_id);
    if (!t.amountOut) {
      console.log(`  skip  ${label}: anchor reports no payout amount (status ${t.status})`);
      skipped++;
      continue;
    }
    console.log(`  ${dry ? 'would set' : 'set'}  ${label}: pays out ${t.amountOut} ${t.amountOutAsset ?? ''} · fee ${t.amountFee ?? '?'} ${t.amountFeeAsset ?? ''} · status ${t.status}`);
    if (!dry) {
      await query(
        `UPDATE escrow_milestones
            SET anchor_amount_out = $3, anchor_amount_out_asset = $4, anchor_fee = $5, anchor_fee_asset = $6,
                anchor_domain = COALESCE(anchor_domain, $7)
          WHERE escrow_id = $1 AND idx = $2 AND anchor_amount_out IS NULL`,
        [r.escrow_id, r.idx, t.amountOut, t.amountOutAsset ?? null, t.amountFee ?? null, t.amountFeeAsset ?? null, domain],
      );
    }
    updated++;
  } catch (err) {
    console.log(`  skip  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    skipped++;
  }
}

console.log(`\n${dry ? 'Would update' : 'Updated'} ${updated}, skipped ${skipped}.`);
process.exit(0);
