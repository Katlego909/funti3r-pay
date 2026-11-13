import { useState } from 'react';
import { toast } from 'sonner';
import { HiOutlineDocumentText } from 'react-icons/hi2';
import { listAllPayments, getFxRates, getXlmPrice } from '../api/payments.js';
import { apiErrorMessage } from '../api/errors.js';
import { makeDisplayCurrency } from '../lib/displayCurrency.js';
import { EXPLORER, IS_MAINNET } from '../lib/explorer.js';
import { generateIncomeStatement } from '../utils/export.js';

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Worker's "Income statement": completed payments over a chosen period, as a PDF with on-chain proof per line. */
export default function IncomeStatementButton({ workerId, workerEmail }: { workerId: string; workerEmail: string }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => isoDay(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [busy, setBusy] = useState(false);

  async function download() {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    if (!(start <= end)) return toast.error('The start date must be on or before the end date.');
    setBusy(true);
    try {
      const [payments, xlmUsd, rates] = await Promise.all([
        listAllPayments({ workerId, status: 'completed' }),
        getXlmPrice(),
        getFxRates(),
      ]);
      const usd = makeDisplayCurrency({ preferred: null, xlmUsd, rates });
      const inPeriod = payments
        .filter((p) => { const t = new Date(p.created_at); return t >= start && t <= end; })
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      await generateIncomeStatement({
        workerEmail,
        from: start,
        to: end,
        payments: inPeriod.map((p) => ({
          createdAt: p.created_at,
          payer: p.company_name || 'Employer',
          amount: Number(p.amount),
          currency: p.currency,
          txHash: p.stellar_tx_hash,
        })),
        toUsdToday: (amount, currency) => usd.convert(amount, currency),
        isMainnet: IS_MAINNET,
        explorerUrl: EXPLORER,
      });
      setOpen(false);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not build the statement. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn-export" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <HiOutlineDocumentText size={14} /> Income statement
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Income statement period"
          style={{
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 260, background: '#fff',
            border: '1px solid var(--gray-200)', borderRadius: 12, padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
          }}
        >
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }} htmlFor="stmt-from">From</label>
          <input id="stmt-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={{ width: '100%', marginBottom: 10 }} />
          <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 4 }} htmlFor="stmt-to">To</label>
          <input id="stmt-to" type="date" value={to} min={from} max={isoDay(new Date())} onChange={(e) => setTo(e.target.value)} style={{ width: '100%', marginBottom: 12 }} />
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={download} disabled={busy}>
            {busy ? 'Building…' : 'Download PDF'}
          </button>
        </div>
      )}
    </div>
  );
}
