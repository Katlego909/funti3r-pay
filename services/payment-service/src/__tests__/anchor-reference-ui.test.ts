import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { autofillReferenceForm, mapReferenceFormFields, referenceAutofillEnabled } from '../lib/anchorReferenceUi.js';

const post = vi.mocked(axios.post);

const DETAILS = {
  first_name: 'Lionel', last_name: 'Rich', email_address: 'createdbylionel@gmail.com',
  bank_number: '23123', bank_account_number: '1234567890', birth_date: '1990-01-01',
};
const URL_OK = 'https://anchor-ref-ui-testanchor.stellar.org/?transaction_id=tx-1&token=interactive-token';

const ENV_KEYS = ['ANCHOR_AUTOFILL_REFERENCE_UI', 'STELLAR_NETWORK', 'ANCHOR_HOME_DOMAIN', 'ANCHOR_REFERENCE_BUSINESS_URL'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ANCHOR_AUTOFILL_REFERENCE_UI = 'true';
  delete process.env.STELLAR_NETWORK;
  process.env.ANCHOR_HOME_DOMAIN = 'testanchor.stellar.org';
  delete process.env.ANCHOR_REFERENCE_BUSINESS_URL;
  post.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('referenceAutofillEnabled — every guard must hold', () => {
  it('is on only for the opted-in testnet reference anchor', () => {
    expect(referenceAutofillEnabled()).toBe(true);
  });

  it('is off unless explicitly enabled', () => {
    delete process.env.ANCHOR_AUTOFILL_REFERENCE_UI;
    expect(referenceAutofillEnabled()).toBe(false);
    process.env.ANCHOR_AUTOFILL_REFERENCE_UI = 'yes';
    expect(referenceAutofillEnabled()).toBe(false);
  });

  it('is never on for mainnet, even if the flag is set', () => {
    process.env.STELLAR_NETWORK = 'MAINNET';
    expect(referenceAutofillEnabled()).toBe(false);
  });

  it('is never on for any other anchor — real anchors run their own KYC', () => {
    process.env.ANCHOR_HOME_DOMAIN = 'api.moneygram.com';
    expect(referenceAutofillEnabled()).toBe(false);
  });
});

describe('mapReferenceFormFields', () => {
  it('maps saved payout details onto the form fields and uses the exact payout amount', () => {
    expect(mapReferenceFormFields('10', DETAILS)).toEqual({
      amount: '10', name: 'Lionel', surname: 'Rich', email: 'createdbylionel@gmail.com',
      bank: '23123', account: '1234567890',
    });
  });

  it('returns null when any required detail is missing', () => {
    for (const key of ['first_name', 'last_name', 'email_address', 'bank_number', 'bank_account_number']) {
      expect(mapReferenceFormFields('10', { ...DETAILS, [key]: '' })).toBeNull();
    }
    expect(mapReferenceFormFields('10', {})).toBeNull();
  });
});

describe('autofillReferenceForm', () => {
  it('starts a session with the interactive token, then submits the form with that session', async () => {
    post.mockResolvedValueOnce({ data: { sessionId: 'session-abc' } }).mockResolvedValueOnce({ data: { sessionId: 'session-abc' } });

    expect(await autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: DETAILS })).toBe(true);

    expect(post).toHaveBeenCalledTimes(2);
    const [startUrl, startBody, startCfg] = post.mock.calls[0] as [string, unknown, { headers: Record<string, string> }];
    expect(startUrl).toBe('https://anchor-reference-server-testanchor.stellar.org/start');
    expect(startBody).toBeUndefined();
    expect(startCfg.headers.Authorization).toBe('Bearer interactive-token');

    const [submitUrl, submitBody, submitCfg] = post.mock.calls[1] as [string, Record<string, string>, { headers: Record<string, string> }];
    expect(submitUrl).toBe('https://anchor-reference-server-testanchor.stellar.org/submit');
    expect(submitCfg.headers.Authorization).toBe('Bearer session-abc');
    expect(submitBody).toEqual({
      amount: '10', name: 'Lionel', surname: 'Rich', email: 'createdbylionel@gmail.com',
      bank: '23123', account: '1234567890',
    });
  });

  it('honors an overridden business server URL', async () => {
    process.env.ANCHOR_REFERENCE_BUSINESS_URL = 'https://business.example';
    post.mockResolvedValue({ data: { sessionId: 's' } });
    await autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '5', details: DETAILS });
    expect(post.mock.calls[0][0]).toBe('https://business.example/start');
  });

  it('does nothing — no network call — when the guards are not met', async () => {
    process.env.STELLAR_NETWORK = 'MAINNET';
    expect(await autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: DETAILS })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('does nothing when the worker has not saved complete bank details', async () => {
    expect(await autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: { first_name: 'Lionel' } })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns false for a link without an interactive token', async () => {
    expect(await autofillReferenceForm({ interactiveUrl: 'https://anchor-ref-ui-testanchor.stellar.org/txn?transaction_id=x', amountXlm: '10', details: DETAILS })).toBe(false);
    expect(await autofillReferenceForm({ interactiveUrl: 'not a url', amountXlm: '10', details: DETAILS })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('returns false — never throws — when the anchor errors, so the manual form remains the fallback', async () => {
    post.mockRejectedValueOnce(new Error('503 from business server'));
    await expect(autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: DETAILS })).resolves.toBe(false);

    post.mockReset();
    post.mockResolvedValueOnce({ data: { sessionId: 's' } }).mockRejectedValueOnce(new Error('400 bad field'));
    await expect(autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: DETAILS })).resolves.toBe(false);
  });

  it('returns false when /start gives no session', async () => {
    post.mockResolvedValueOnce({ data: {} });
    expect(await autofillReferenceForm({ interactiveUrl: URL_OK, amountXlm: '10', details: DETAILS })).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
  });
});
