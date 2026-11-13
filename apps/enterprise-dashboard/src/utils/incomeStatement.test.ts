import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateIncomeStatement, type IncomeStatementData } from './export.js';

const capture = vi.hoisted(() => ({ saved: null as { name: string; text: string } | null }));

// The real jsPDF, except that save() keeps the finished PDF instead of downloading it. jsPDF writes text uncompressed
// by default, so the output is searchable. save is set per instance, so it is replaced after construction.
vi.mock('jspdf', async (importOriginal) => {
  const mod = await importOriginal<typeof import('jspdf')>();
  class CapturingPdf extends mod.jsPDF {
    constructor(...args: ConstructorParameters<typeof mod.jsPDF>) {
      super(...args);
      (this as any).save = (name: string) => {
        capture.saved = { name, text: this.output() };
        return this;
      };
    }
  }
  return { ...mod, jsPDF: CapturingPdf, default: CapturingPdf };
});

let saved: { name: string; text: string } | null = null;
beforeEach(() => { capture.saved = null; });
const run = async (data: IncomeStatementData) => {
  await generateIncomeStatement(data);
  saved = capture.saved;
};

const base: IncomeStatementData = {
  workerEmail: 'ada@example.com',
  from: new Date('2026-01-01T00:00:00Z'),
  to: new Date('2026-06-30T23:59:59Z'),
  payments: [
    { createdAt: '2026-02-01T10:00:00Z', payer: 'Acme Ltd', amount: 100, currency: 'USDC', txHash: 'a'.repeat(64) },
    { createdAt: '2026-03-01T10:00:00Z', payer: 'Acme Ltd', amount: 50, currency: 'USDC', txHash: 'b'.repeat(64) },
    { createdAt: '2026-04-01T10:00:00Z', payer: 'Beta Co', amount: 1800, currency: 'ZAR', txHash: 'c'.repeat(64) },
  ],
  toUsdToday: (amount, currency) => (currency === 'USDC' ? amount : currency === 'ZAR' ? amount / 18 : null),
  isMainnet: false,
  explorerUrl: 'https://stellar.expert/explorer/testnet',
};

describe('generateIncomeStatement', () => {
  it('totals each currency, values them in USD at today\'s rates and lists every transaction', async () => {
    await run(base);

    expect(saved?.name).toBe('funti3rpay-income-statement-2026-01-01-to-2026-06-30.pdf');
    const t = saved!.text;
    expect(t).toContain('150 USDC');
    expect(t).toContain('1,800 ZAR');
    expect(t).toContain('$250.00');
    expect(t).toContain('a'.repeat(64));
    expect(t).toContain('c'.repeat(64));
    expect(t).toContain('ada@example.com');
  });

  it('marks a test-network statement as not proof of income', async () => {
    await run(base);
    expect(saved!.text).toContain('NOT VALID AS PROOF OF INCOME');
  });

  it('carries no test-network warning on mainnet', async () => {
    await run({ ...base, isMainnet: true, explorerUrl: 'https://stellar.expert/explorer/public' });
    expect(saved!.text).not.toContain('NOT VALID AS PROOF OF INCOME');
  });

  it('says when a currency had no rate', async () => {
    await run({ ...base, toUsdToday: (a, c) => (c === 'USDC' ? a : null) });
    expect(saved!.text).toContain('excludes currencies with no rate');
  });
});
