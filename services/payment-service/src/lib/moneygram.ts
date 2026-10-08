/**
 * MoneyGram Ramps client (custodial partner) — USDC cash-out on Stellar.
 *
 * Flow: our server creates a session with the SECRET key; the browser embeds
 * MoneyGram's widget with the session token (KYC, quote, pickup location live
 * in the widget); when the user confirms, the widget hands the page a deposit
 * address + memo; we verify that against MoneyGram's own record of the
 * transaction, then send the USDC from the worker's custodial wallet.
 *
 * The browser is not trusted: the deposit details it reports are only acted on
 * after `checkDeposit` matches them to what MoneyGram says for THIS worker.
 *
 * MoneyGram's transaction record also carries the customer's KYC (ID number,
 * address, phone). `parseTransaction` copies a fixed allowlist of fields and
 * never touches that data — it is not logged, stored or returned.
 */
import axios from 'axios';
import { StrKey } from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('MoneyGram');

const DEFAULT_API_BASE = 'https://playground.xramps.moneygram.com/api/v1';

export function moneygramConfigured(): boolean {
  return !!process.env.MONEYGRAM_SK && !!process.env.MONEYGRAM_PK;
}

/** Public (browser-safe) key — never the secret. */
export function moneygramPublicKey(): string {
  const pk = process.env.MONEYGRAM_PK;
  if (!pk) throw new Error('MONEYGRAM_PK is not configured');
  return pk;
}

function secretKey(): string {
  const sk = process.env.MONEYGRAM_SK;
  if (!sk) throw new Error('MONEYGRAM_SK is not configured');
  return sk;
}

/** The secret key is only ever sent to a moneygram.com host. */
export function apiBase(): string {
  const base = (process.env.MONEYGRAM_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');
  const host = new URL(base).hostname;
  if (host !== 'moneygram.com' && !host.endsWith('.moneygram.com')) {
    throw new Error(`Refusing to send the MoneyGram secret key to ${host}`);
  }
  return base;
}

/** True while pointed at MoneyGram's playground: no real cash is dispensed. */
export function moneygramSandbox(): boolean {
  try {
    return new URL(apiBase()).hostname.startsWith('playground.');
  } catch {
    return false;
  }
}

const http = () => ({ headers: { 'x-api-key': secretKey() }, timeout: 20000 });

// ── Sessions ──────────────────────────────────────────────────────────────────

export interface RampsSession {
  sessionId: string;
  sessionToken: string;
  widgetUrl: string;
}

/** Custodial session: `customerIdentifier` is our stable id for the worker. */
export async function createSession(opts: { customerIdentifier: string; walletAddress: string }): Promise<RampsSession> {
  const { data } = await axios.post(
    `${apiBase()}/sessions`,
    { customerIdentifier: opts.customerIdentifier, walletAddress: opts.walletAddress, chain: 'stellar' },
    http(),
  );
  if (!data?.sessionToken || !data?.widgetUrl) throw new Error('MoneyGram returned an incomplete session');
  logger.info('MoneyGram session created', { sessionId: data.sessionId });
  return { sessionId: data.sessionId, sessionToken: data.sessionToken, widgetUrl: data.widgetUrl };
}

// ── Transactions ──────────────────────────────────────────────────────────────

export interface RampsTransaction {
  id: string;
  mgiTransactionId: string | null;
  customerIdentifier: string | null;
  type: string | null;
  status: string;
  depositAddress: string | null;
  depositMemo: string | null;
  depositExpiresAt: string | null;
  sendAmount: number | null;
  sendAsset: string | null;
  sendChain: string | null;
  sourceWalletAddress: string | null;
  /** The number the recipient quotes at the MoneyGram location to collect cash. */
  referenceNumber: string | null;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  destinationCountry: string | null;
  feeTotal: string | null;
  feeCurrency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' || typeof v === 'number' ? String(v) : null);

/**
 * Allowlist-copy of the fields we use. Deliberately never reads `kycData` or any
 * other personal data MoneyGram includes in the record.
 */
export function parseTransaction(raw: Record<string, any> | null | undefined): RampsTransaction | null {
  if (!raw || typeof raw !== 'object' || !raw.transactionId || !raw.status) return null;
  return {
    id: String(raw.transactionId),
    mgiTransactionId: str(raw.mgiTransactionId),
    customerIdentifier: str(raw.customerIdentifier),
    type: str(raw.transactionType),
    status: String(raw.status),
    depositAddress: str(raw.depositAddress),
    depositMemo: str(raw.depositMemo),
    depositExpiresAt: str(raw.depositExpiresAt),
    sendAmount: typeof raw.sendAmount === 'number' ? raw.sendAmount : raw.sendAmount != null ? Number(raw.sendAmount) : null,
    sendAsset: str(raw.sendAsset),
    sendChain: str(raw.sendChain),
    sourceWalletAddress: str(raw.sourceWalletAddress),
    referenceNumber: str(raw.referenceNumber),
    receiveAmount: str(raw.receiveAmount),
    receiveCurrency: str(raw.receiveCurrency),
    destinationCountry: str(raw.destinationCountry),
    feeTotal: str(raw.quote?.fees?.total?.value),
    feeCurrency: str(raw.quote?.fees?.total?.currency),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

/** Every transaction under our key. The API has no per-id lookup, so callers filter. */
export async function listTransactions(): Promise<RampsTransaction[]> {
  const { data } = await axios.get(`${apiBase()}/transactions`, http());
  const rows: unknown[] = Array.isArray(data?.transactions) ? data.transactions : [];
  return rows.map((r) => parseTransaction(r as Record<string, any>)).filter((t): t is RampsTransaction => t !== null);
}

export async function getTransaction(id: string): Promise<RampsTransaction | undefined> {
  return (await listTransactions()).find((t) => t.id === id);
}

// ── Verifying what the browser reports ────────────────────────────────────────

/** What the widget told the browser (and the browser told us) — untrusted. */
export interface DepositClaim {
  address: string;
  memo: string;
  amount: string;
}

/** Finds MoneyGram's record of the transaction the claim is about. */
export function findClaimedTransaction(txs: RampsTransaction[], claim: DepositClaim): RampsTransaction | undefined {
  return txs.find((t) => t.depositAddress === claim.address && t.depositMemo === claim.memo);
}

/**
 * Decides whether a deposit request is genuine. Every condition must hold, and
 * MoneyGram's record (not the claim) is the authority.
 */
export function checkDeposit(
  tx: RampsTransaction | undefined,
  expect: { customerIdentifier: string; walletAddress: string; claim: DepositClaim; now?: number },
): { ok: true; tx: RampsTransaction } | { ok: false; reason: string } {
  const { claim } = expect;
  if (!tx) return { ok: false, reason: 'MoneyGram has no matching transaction for this deposit' };
  if (tx.type !== 'cash-out') return { ok: false, reason: 'Not a cash-out transaction' };
  if (tx.customerIdentifier !== expect.customerIdentifier) return { ok: false, reason: 'Transaction belongs to a different customer' };
  if (tx.sourceWalletAddress !== expect.walletAddress) return { ok: false, reason: 'Transaction was opened for a different wallet' };
  if (tx.sendChain !== 'stellar' || tx.sendAsset !== 'USDC') return { ok: false, reason: 'Only USDC on Stellar is supported' };
  if (tx.status !== 'awaiting_funds') return { ok: false, reason: `Transaction is ${tx.status}, not awaiting funds` };
  if (claim.address !== tx.depositAddress || claim.memo !== tx.depositMemo) {
    return { ok: false, reason: 'Deposit address or memo does not match MoneyGram\'s record' };
  }
  if (tx.sendAmount === null || Number(claim.amount) !== tx.sendAmount) {
    return { ok: false, reason: 'Deposit amount does not match MoneyGram\'s record' };
  }
  if (!tx.depositAddress || !StrKey.isValidEd25519PublicKey(tx.depositAddress)) {
    return { ok: false, reason: 'MoneyGram gave an invalid deposit address' };
  }
  if (!tx.depositMemo || !/^\d{1,20}$/.test(tx.depositMemo)) {
    return { ok: false, reason: 'MoneyGram gave an invalid deposit memo' };
  }
  const expires = tx.depositExpiresAt ? Date.parse(tx.depositExpiresAt) : NaN;
  if (!Number.isFinite(expires) || expires - (expect.now ?? Date.now()) < 15_000) {
    return { ok: false, reason: 'The deposit window has expired — start the cash-out again' };
  }
  return { ok: true, tx };
}
