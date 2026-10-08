/**
 * Testnet-only convenience for the SDF reference anchor (testanchor.stellar.org).
 *
 * Its SEP-24 form hardcodes every field to "" and ignores the SEP-9 prefill the
 * spec lets us send, so a worker would retype details they already saved. The
 * form is only a front-end for two calls to the anchor's "business server"
 * (what stellar/sep24-reference-ui/src/pages/Kyc.tsx does on Submit):
 *
 *   POST {business}/start   Authorization: Bearer <interactive token>  -> { sessionId }
 *   POST {business}/submit  Authorization: Bearer <sessionId>  { amount, name, surname, email, bank, account }
 *
 * We make those calls ourselves with the worker's saved payout details, so the
 * cash-out completes with no manual step.
 *
 * This is undocumented sandbox plumbing, so it is deliberately narrow:
 *  - opt-in (ANCHOR_AUTOFILL_REFERENCE_UI=true), never on mainnet, only for the
 *    SDF reference anchor — a real anchor runs its own interactive KYC, which we
 *    must not (and cannot) automate;
 *  - best effort: any problem returns false and the caller falls back to the
 *    normal "complete the anchor form" step.
 */
import axios from 'axios';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('AnchorReferenceUi');

const REFERENCE_ANCHOR_DOMAIN = 'testanchor.stellar.org';
const DEFAULT_BUSINESS_URL = 'https://anchor-reference-server-testanchor.stellar.org';

/** All three guards must hold: flag on, not mainnet, and the SDF reference anchor. */
export function referenceAutofillEnabled(): boolean {
  return process.env.ANCHOR_AUTOFILL_REFERENCE_UI === 'true'
    && process.env.STELLAR_NETWORK !== 'MAINNET'
    && process.env.ANCHOR_HOME_DOMAIN === REFERENCE_ANCHOR_DOMAIN;
}

/** The form's six fields, taken from the worker's saved payout details. */
export function mapReferenceFormFields(
  amountXlm: string,
  details: Record<string, string>,
): { amount: string; name: string; surname: string; email: string; bank: string; account: string } | null {
  const { first_name, last_name, email_address, bank_number, bank_account_number } = details;
  if (!first_name || !last_name || !email_address || !bank_number || !bank_account_number) return null;
  return {
    amount: amountXlm,
    name: first_name,
    surname: last_name,
    email: email_address,
    bank: bank_number,
    account: bank_account_number,
  };
}

/**
 * Fills in and submits the reference anchor's interactive form for the worker.
 * Resolves true when the anchor accepted it, false otherwise (never throws).
 */
export async function autofillReferenceForm(opts: {
  interactiveUrl: string;
  amountXlm: string;
  details: Record<string, string>;
}): Promise<boolean> {
  if (!referenceAutofillEnabled()) return false;

  const fields = mapReferenceFormFields(opts.amountXlm, opts.details);
  if (!fields) {
    logger.info('Reference form not auto-filled — payout details are incomplete');
    return false;
  }

  try {
    const token = new URL(opts.interactiveUrl).searchParams.get('token');
    if (!token) return false;

    const business = process.env.ANCHOR_REFERENCE_BUSINESS_URL || DEFAULT_BUSINESS_URL;
    const started = await axios.post<{ sessionId?: string }>(`${business}/start`, undefined, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });
    const sessionId = started.data?.sessionId;
    if (!sessionId) return false;

    await axios.post(`${business}/submit`, fields, {
      headers: { Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    logger.info('Reference anchor form submitted on the worker\'s behalf');
    return true;
  } catch (err) {
    logger.warn('Reference anchor auto-fill failed — falling back to the manual form', { error: String(err) });
    return false;
  }
}
