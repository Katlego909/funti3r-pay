import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { sep24GetTransaction, sep6GetTransaction } from '../lib/anchor.js';

const TOML = `
WEB_AUTH_ENDPOINT = "https://anchor.test/auth"
KYC_SERVER = "https://anchor.test/sep12"
TRANSFER_SERVER = "https://anchor.test/sep6"
TRANSFER_SERVER_SEP0024 = "https://anchor.test/sep24"
SIGNING_KEY = "GSIGNINGKEY"
`;

/** Serves the anchor's stellar.toml, then whatever transaction record the test sets. */
function serve(transaction: Record<string, unknown>) {
  vi.mocked(axios.get).mockImplementation(async (url: string) => (
    url.includes('stellar.toml') ? { data: TOML } : { data: { transaction } }
  ) as never);
}

beforeEach(() => {
  process.env.ANCHOR_HOME_DOMAIN = 'anchor.test';
  vi.mocked(axios.get).mockReset();
});

describe.each([
  ['SEP-24', sep24GetTransaction],
  ['SEP-6', sep6GetTransaction],
])('%s transaction record', (_name, get) => {
  it('reads the anchor fee from fee_details (current SEPs)', async () => {
    serve({ id: 'tx', status: 'completed', amount_out: '9.0', amount_out_asset: 'iso4217:USD', fee_details: { total: '1.0', asset: 'stellar:native' } });
    expect(await get('jwt', 'tx')).toMatchObject({
      amountOut: '9.0', amountOutAsset: 'iso4217:USD', amountFee: '1.0', amountFeeAsset: 'stellar:native',
    });
  });

  it('still reads the older amount_fee fields', async () => {
    serve({ id: 'tx', status: 'completed', amount_fee: '2.5', amount_fee_asset: 'stellar:native' });
    expect(await get('jwt', 'tx')).toMatchObject({ amountFee: '2.5', amountFeeAsset: 'stellar:native' });
  });

  it('reports no fee when the anchor gives none', async () => {
    serve({ id: 'tx', status: 'pending_anchor' });
    const t = await get('jwt', 'tx');
    expect(t.amountFee).toBeUndefined();
    expect(t.amountOut).toBeUndefined();
  });
});
