import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import * as anchorLib from '../lib/anchor.js';
import { autofillReferenceForm } from '../lib/anchorReferenceUi.js';
import { sendPayment } from '../lib/stellar.js';

// Only the network-facing anchor calls are replaced; AnchorActionRequiredError & co. stay real.
vi.mock('../lib/anchor.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/anchor.js')>()),
  sep10Auth: vi.fn(),
  sep12PutCustomer: vi.fn(),
  anchorProtocol: vi.fn(),
  sep24WithdrawInfo: vi.fn(),
  sep24WithdrawInteractive: vi.fn(),
  sep24AwaitSettlementDetails: vi.fn(),
  anchorGetTransaction: vi.fn(),
}));
vi.mock('../lib/anchorReferenceUi.js', () => ({ autofillReferenceForm: vi.fn() }));

// setup.ts replaces the rail for the route tests; this file tests the real one.
const { sendAnchorPayout } = await vi.importActual<typeof import('../rails/anchor.js')>('../rails/anchor.js');

const DETAILS = {
  first_name: 'Lionel', last_name: 'Rich', email_address: 'createdbylionel@gmail.com',
  bank_number: '23123', bank_account_number: '1234567890',
};
const FORM_URL = 'https://anchor-ref-ui-testanchor.stellar.org/?transaction_id=tx-1&token=t';
const payerSecret = Keypair.random().secret();

const mocks = {
  customer: vi.mocked(anchorLib.sep12PutCustomer),
  interactive: vi.mocked(anchorLib.sep24WithdrawInteractive),
  settlement: vi.mocked(anchorLib.sep24AwaitSettlementDetails),
  status: vi.mocked(anchorLib.anchorGetTransaction),
  autofill: vi.mocked(autofillReferenceForm),
  pay: vi.mocked(sendPayment),
};

/** Runs the payout while advancing the rail's fixed 3s status wait. */
async function runPayout(extra: Partial<Parameters<typeof sendAnchorPayout>[0]> = {}) {
  const p = sendAnchorPayout({ payerSecret, amountXlm: '10', kyc: DETAILS, ...extra });
  const settled = p.then((v) => ({ ok: v }), (e) => ({ err: e }));
  await vi.advanceTimersByTimeAsync(3500);
  return settled;
}

let savedDomain: string | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  savedDomain = process.env.ANCHOR_HOME_DOMAIN;
  process.env.ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';
  vi.mocked(anchorLib.sep10Auth).mockReset().mockResolvedValue('jwt');
  vi.mocked(anchorLib.anchorProtocol).mockReset().mockResolvedValue('sep24');
  vi.mocked(anchorLib.sep24WithdrawInfo).mockReset().mockResolvedValue([{ code: 'native', minAmount: 1, maxAmount: 10 }]);
  mocks.customer.mockReset().mockResolvedValue('customer-42');
  mocks.interactive.mockReset().mockResolvedValue({ id: 'anchor-tx-1', url: FORM_URL });
  mocks.settlement.mockReset().mockResolvedValue({ accountId: 'GANCHOR', memoType: 'id', memo: '123', amountIn: '10' });
  mocks.status.mockReset().mockResolvedValue({
    id: 'anchor-tx-1', status: 'completed',
    amountOut: '9.0', amountOutAsset: 'iso4217:USD', amountFee: '1.0', amountFeeAsset: 'stellar:native',
  });
  mocks.autofill.mockReset().mockResolvedValue(true);
  mocks.pay.mockReset().mockResolvedValue('settlement-hash');
});
afterEach(() => {
  vi.useRealTimers();
  if (savedDomain === undefined) delete process.env.ANCHOR_HOME_DOMAIN;
  else process.env.ANCHOR_HOME_DOMAIN = savedDomain;
});

describe('SEP-24 anchor rail', () => {
  it('ties the interactive request to the KYC already filed (customer_id) and forwards the saved details', async () => {
    await runPayout();
    expect(mocks.interactive).toHaveBeenCalledWith('jwt', expect.objectContaining({
      assetCode: 'native', amount: '10', customerId: 'customer-42',
      prefill: expect.objectContaining({ first_name: 'Lionel', bank_account_number: '1234567890' }),
    }));
  });

  it('attempts the sandbox auto-fill with the form link, the exact amount and the saved details', async () => {
    await runPayout();
    expect(mocks.autofill).toHaveBeenCalledWith({ interactiveUrl: FORM_URL, amountXlm: '10', details: DETAILS });
  });

  it('when the form was filled for the worker, the cash-out completes with no manual step', async () => {
    const out = await runPayout();
    expect(out).toEqual({
      ok: {
        settlementHash: 'settlement-hash', anchorTxId: 'anchor-tx-1', anchorStatus: 'completed',
        // What the anchor says it pays out, kept so the worker can see it.
        receipt: { amountOut: '9.0', amountOutAsset: 'iso4217:USD', fee: '1.0', feeAsset: 'stellar:native' },
      },
    });
    expect(mocks.pay).toHaveBeenCalledWith(payerSecret, 'GANCHOR', '10', 'XLM', undefined, expect.anything());
  });

  it('if the auto-fill does not take, the worker still gets the manual form step (fallback intact)', async () => {
    mocks.autofill.mockResolvedValue(false);
    mocks.settlement.mockRejectedValue(new anchorLib.AnchorActionRequiredError('anchor-tx-1', FORM_URL));

    const out = await runPayout();
    expect(out).toMatchObject({ err: expect.any(anchorLib.AnchorActionRequiredError) });
    expect(mocks.pay).not.toHaveBeenCalled();
  });

  it('never pays when the anchor recorded a different amount than the payout', async () => {
    mocks.settlement.mockResolvedValue({ accountId: 'GANCHOR', memoType: 'id', memo: '123', amountIn: '5' });
    const out = await runPayout();
    expect(out).toMatchObject({ err: expect.any(anchorLib.AnchorAmountMismatchError) });
    expect(mocks.pay).not.toHaveBeenCalled();
  });
});
