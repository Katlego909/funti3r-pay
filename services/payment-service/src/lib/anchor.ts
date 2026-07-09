/**
 * Stellar anchor client — the real SEP protocol stack used for anchor-routed
 * disbursements (bank / cash-out):
 *
 *   SEP-1  stellar.toml discovery (auth, KYC, transfer/direct-payment endpoints)
 *   SEP-10 web authentication (challenge → sign → JWT)
 *   SEP-12 receiver KYC registration
 *   SEP-31 direct payment (server-to-server rail, e.g. MoneyGram-style anchors)
 *   SEP-6  programmatic withdraw (off-ramp) — what the SDF reference anchor
 *          has enabled today (its SEP-31 receive list is currently empty)
 *
 * The rail probes SEP-31 first and falls back to SEP-6 withdraw, so swapping
 * ANCHOR_HOME_DOMAIN to a production anchor requires no code change.
 */
import axios from 'axios';
import { Keypair, Memo, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('AnchorClient');

const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === 'MAINNET' ? Networks.PUBLIC : Networks.TESTNET;

export function anchorHomeDomain(): string {
  const domain = process.env.ANCHOR_HOME_DOMAIN;
  if (!domain) throw new Error('ANCHOR_HOME_DOMAIN is not configured');
  return domain;
}

// ── SEP-1: stellar.toml discovery ─────────────────────────────────────────────

export interface AnchorConfig {
  webAuthEndpoint: string;
  kycServer: string;
  directPaymentServer: string;
  transferServer: string;
  signingKey: string;
}

let tomlCache: { domain: string; config: AnchorConfig } | null = null;

/** Minimal TOML value extraction — the four flat keys we need. */
function tomlValue(toml: string, key: string): string | undefined {
  const m = toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return m?.[1];
}

export async function fetchAnchorConfig(): Promise<AnchorConfig> {
  const domain = anchorHomeDomain();
  if (tomlCache?.domain === domain) return tomlCache.config;

  const { data } = await axios.get<string>(`https://${domain}/.well-known/stellar.toml`, {
    timeout: 15000, responseType: 'text',
  });

  const webAuthEndpoint = tomlValue(data, 'WEB_AUTH_ENDPOINT');
  const kycServer = tomlValue(data, 'KYC_SERVER');
  const directPaymentServer = tomlValue(data, 'DIRECT_PAYMENT_SERVER');
  const transferServer = tomlValue(data, 'TRANSFER_SERVER');
  const signingKey = tomlValue(data, 'SIGNING_KEY');
  if (!webAuthEndpoint || !signingKey || (!directPaymentServer && !transferServer)) {
    throw new Error(`Anchor ${domain} toml is missing WEB_AUTH_ENDPOINT/SIGNING_KEY or any payment server`);
  }
  const config: AnchorConfig = {
    webAuthEndpoint,
    kycServer: kycServer ?? '',
    directPaymentServer: directPaymentServer ?? '',
    transferServer: transferServer ?? '',
    signingKey,
  };
  tomlCache = { domain, config };
  logger.info('Anchor config resolved', { domain, directPaymentServer });
  return config;
}

// ── SEP-10: web authentication ────────────────────────────────────────────────

export async function sep10Auth(accountSecret: string): Promise<string> {
  const config = await fetchAnchorConfig();
  const keypair = Keypair.fromSecret(accountSecret);

  const { data: challenge } = await axios.get<{ transaction: string; network_passphrase?: string }>(
    config.webAuthEndpoint,
    { params: { account: keypair.publicKey(), home_domain: anchorHomeDomain() }, timeout: 15000 },
  );
  if (challenge.network_passphrase && challenge.network_passphrase !== NETWORK_PASSPHRASE) {
    throw new Error(`Anchor challenge is for a different network: ${challenge.network_passphrase}`);
  }

  const tx = TransactionBuilder.fromXDR(challenge.transaction, NETWORK_PASSPHRASE);
  // Challenge sanity checks per SEP-10: signed by the anchor's SIGNING_KEY,
  // sequence number 0 (never submittable to the network).
  if (!('sequence' in tx) || tx.sequence !== '0') {
    throw new Error('Invalid SEP-10 challenge: sequence number is not 0');
  }
  if (tx.source !== (await fetchAnchorConfig()).signingKey) {
    throw new Error('Invalid SEP-10 challenge: source is not the anchor signing key');
  }

  tx.sign(keypair);
  const { data: auth } = await axios.post<{ token: string }>(
    config.webAuthEndpoint,
    { transaction: tx.toXDR() },
    { timeout: 15000 },
  );
  logger.info('SEP-10 authenticated', { account: keypair.publicKey() });
  return auth.token;
}

// ── SEP-12: receiver KYC ──────────────────────────────────────────────────────

export interface CustomerFields {
  first_name: string;
  last_name: string;
  email_address?: string;
  [key: string]: string | undefined;
}

export interface CustomerStatus {
  id?: string;
  status: string; // ACCEPTED | PROCESSING | NEEDS_INFO | REJECTED
  /** Field name → spec, for fields the anchor still requires. */
  requiredFields: Record<string, { description?: string; optional?: boolean; choices?: string[] }>;
}

/** What does the anchor still need to know about this customer? */
export async function sep12GetCustomer(
  jwt: string,
  params: { id?: string; transactionId?: string } = {},
): Promise<CustomerStatus> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(`${config.kycServer}/customer`, {
    params: {
      ...(params.id ? { id: params.id } : {}),
      ...(params.transactionId ? { transaction_id: params.transactionId } : {}),
    },
    headers: { Authorization: `Bearer ${jwt}` },
    timeout: 15000,
  });
  const required: CustomerStatus['requiredFields'] = {};
  for (const [name, spec] of Object.entries<any>(data?.fields ?? {})) {
    if (!spec?.optional) required[name] = spec;
  }
  return { id: data?.id, status: data?.status ?? 'unknown', requiredFields: required };
}

export async function sep12PutCustomer(
  jwt: string,
  fields: CustomerFields,
  type?: string,
): Promise<string> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.put<{ id: string }>(
    `${config.kycServer}/customer`,
    { ...(type ? { type } : {}), ...fields },
    { headers: { Authorization: `Bearer ${jwt}` }, timeout: 15000 },
  );
  logger.info('SEP-12 customer registered', { customerId: data.id, type });
  return data.id;
}

// ── SEP-31: direct payments ───────────────────────────────────────────────────

export interface Sep31AssetInfo {
  code: string;
  issuer?: string;
  receiverTypes: string[]; // SEP-12 customer types the receiver may register as
  transactionFields: Record<string, unknown>;
}

export async function sep31Info(jwt: string): Promise<Sep31AssetInfo[]> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(
    `${config.directPaymentServer}/info`,
    { headers: { Authorization: `Bearer ${jwt}` }, timeout: 15000 },
  );
  const receive = data?.receive ?? {};
  return Object.entries<any>(receive)
    .filter(([, v]) => v?.enabled !== false)
    .map(([code, v]) => ({
      code,
      issuer: v?.asset_issuer,
      receiverTypes: Object.keys(v?.sep12?.receiver?.types ?? {}),
      transactionFields: v?.fields?.transaction ?? {},
    }));
}

export interface Sep31Transaction {
  id: string;
  stellarAccountId: string;
  stellarMemoType: string;
  stellarMemo: string;
}

export async function sep31CreateTransaction(
  jwt: string,
  params: {
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    receiverId: string;
    transactionFields?: Record<string, string>;
  },
): Promise<Sep31Transaction> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.post(
    `${config.directPaymentServer}/transactions`,
    {
      amount: params.amount,
      asset_code: params.assetCode,
      ...(params.assetIssuer ? { asset_issuer: params.assetIssuer } : {}),
      receiver_id: params.receiverId,
      ...(params.transactionFields ? { fields: { transaction: params.transactionFields } } : {}),
    },
    { headers: { Authorization: `Bearer ${jwt}` }, timeout: 20000 },
  );
  logger.info('SEP-31 transaction created', { id: data.id });
  return {
    id: data.id,
    stellarAccountId: data.stellar_account_id,
    stellarMemoType: data.stellar_memo_type,
    stellarMemo: data.stellar_memo,
  };
}

export interface Sep31Status {
  id: string;
  status: string;
  requiredInfoMessage?: string;
}

export async function sep31GetTransaction(jwt: string, id: string): Promise<Sep31Status> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(
    `${config.directPaymentServer}/transactions/${id}`,
    { headers: { Authorization: `Bearer ${jwt}` }, timeout: 15000 },
  );
  return {
    id: data.transaction?.id ?? id,
    status: data.transaction?.status ?? 'unknown',
    requiredInfoMessage: data.transaction?.required_info_message,
  };
}

/** Build the settlement-payment memo exactly as the anchor dictated it. */
export function anchorMemo(memoType: string, memo: string): Memo {
  switch (memoType) {
    case 'id': return Memo.id(memo);
    case 'text': return Memo.text(memo);
    case 'hash': return Memo.hash(Buffer.from(memo, 'base64').toString('hex'));
    default: throw new Error(`Unsupported anchor memo type: ${memoType}`);
  }
}

// ── SEP-6: programmatic withdraw (off-ramp) ───────────────────────────────────

export interface Sep6WithdrawAsset {
  code: string;
  minAmount?: number;
  maxAmount?: number;
  /** e.g. ['bank_account', 'cash'] */
  types: string[];
}

export async function sep6WithdrawInfo(): Promise<Sep6WithdrawAsset[]> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(`${config.transferServer}/info`, { timeout: 15000 });
  return Object.entries<any>(data?.withdraw ?? {})
    .filter(([, v]) => v?.enabled)
    .map(([code, v]) => ({
      code,
      minAmount: v?.min_amount,
      maxAmount: v?.max_amount,
      types: Object.keys(v?.types ?? {}),
    }));
}

export interface Sep6Withdrawal {
  id: string;
  accountId: string;
  memoType: string;
  memo: string;
}

/** Initiate a withdrawal: the anchor answers with where to send the on-chain funds. */
export async function sep6Withdraw(
  jwt: string,
  params: { assetCode: string; type: string; amount: string; dest?: string; destExtra?: string },
): Promise<Sep6Withdrawal> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(`${config.transferServer}/withdraw`, {
    params: {
      asset_code: params.assetCode,
      type: params.type,
      amount: params.amount,
      ...(params.dest ? { dest: params.dest } : {}),
      ...(params.destExtra ? { dest_extra: params.destExtra } : {}),
    },
    headers: { Authorization: `Bearer ${jwt}` },
    timeout: 20000,
  });
  logger.info('SEP-6 withdrawal initiated', { id: data.id });
  return {
    id: data.id,
    accountId: data.account_id,
    memoType: data.memo_type,
    memo: data.memo,
  };
}

export interface Sep6TransactionStatus extends Sep31Status {
  /** Settlement details — present once the anchor is ready to receive funds. */
  withdrawAnchorAccount?: string;
  withdrawMemo?: string;
  withdrawMemoType?: string;
}

export async function sep6GetTransaction(jwt: string, id: string): Promise<Sep6TransactionStatus> {
  const config = await fetchAnchorConfig();
  const { data } = await axios.get(`${config.transferServer}/transaction`, {
    params: { id },
    headers: { Authorization: `Bearer ${jwt}` },
    timeout: 15000,
  });
  const t = data.transaction ?? {};
  return {
    id: t.id ?? id,
    status: t.status ?? 'unknown',
    requiredInfoMessage: t.required_info_message,
    withdrawAnchorAccount: t.withdraw_anchor_account,
    withdrawMemo: t.withdraw_memo,
    withdrawMemoType: t.withdraw_memo_type,
  };
}

/**
 * SEP-6 withdraw responses may omit settlement details; they appear on the
 * transaction record once status = pending_user_transfer_start. Wait for
 * them, satisfying `pending_customer_info_update` KYC round-trips along the
 * way via `provideKycField` (field name → value).
 */
export async function sep6AwaitSettlementDetails(
  jwt: string,
  id: string,
  provideKycField: (name: string, spec: { description?: string; choices?: string[] }) => string,
  // The public reference anchor can take well over a minute to move from
  // "KYC accepted" to "settlement details ready" — it's a shared sandbox,
  // not production infra. Poll patiently rather than failing an otherwise
  // healthy payout.
  timeoutMs = 180_000,
): Promise<{ accountId: string; memoType: string; memo: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = '';
  let submittedFields = false;
  for (;;) {
    const t = await sep6GetTransaction(jwt, id);
    if (t.withdrawAnchorAccount && t.withdrawMemo) {
      return { accountId: t.withdrawAnchorAccount, memoType: t.withdrawMemoType ?? 'hash', memo: t.withdrawMemo };
    }
    if (t.status !== lastStatus) {
      logger.info('Anchor withdrawal status', { id, status: t.status });
      lastStatus = t.status;
    }
    if (['error', 'refunded', 'expired'].includes(t.status)) {
      throw new Error(`Anchor rejected withdrawal ${id}: ${t.status}${t.requiredInfoMessage ? ` — ${t.requiredInfoMessage}` : ''}`);
    }
    // Known "actively settling, just wait" statuses — no KYC action needed.
    const settling = ['pending_anchor', 'pending_stellar', 'pending_external', 'pending_user_transfer_start'].includes(t.status);
    // Any other non-terminal status (pending_customer_info_update, incomplete,
    // or anything else the anchor invents) may mean it's still waiting on
    // customer info — check and resupply once per episode. Re-checking is
    // cheap; NOT checking is what caused a real stuck-at-'incomplete' payout.
    if (!settling && !submittedFields) {
      const customer = await sep12GetCustomer(jwt, { transactionId: id });
      const missing = Object.entries(customer.requiredFields);
      if (missing.length > 0) {
        const fields: Record<string, string> = {};
        for (const [name, spec] of missing) fields[name] = provideKycField(name, spec);
        logger.info('Anchor requested additional KYC fields', { id, status: t.status, fields: Object.keys(fields) });
        await sep12PutCustomer(jwt, fields as unknown as CustomerFields);
      }
      submittedFields = true; // don't hammer the anchor every 3s regardless of outcome
    } else if (settling) {
      submittedFields = false; // a later "needs info" episode should resubmit
    }
    if (Date.now() > deadline) {
      throw new Error(`Anchor never provided settlement details for withdrawal ${id} (status ${t.status})`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
