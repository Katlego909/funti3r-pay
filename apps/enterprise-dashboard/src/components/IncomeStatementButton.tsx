import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { HiOutlineDocumentText, HiOutlineXMark, HiOutlineArrowDownTray, HiOutlineCalendar } from 'react-icons/hi2';
import { listAllPayments, getFxRates, getXlmPrice, type Payment } from '../api/payments.js';
import { apiErrorMessage } from '../api/errors.js';
import { makeDisplayCurrency } from '../lib/displayCurrency.js';
import { EXPLORER, IS_MAINNET } from '../lib/explorer.js';
import { generateIncomeStatement } from '../utils/export.js';

/** YYYY-MM-DD of a date in the viewer's own timezone (toISOString would shift it to UTC, a day early east of GMT). */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Preset = 'this-year' | 'last-year' | 'last-12' | 'last-month' | 'custom';

function presetRange(p: Exclude<Preset, 'custom'>, now = new Date()): [string, string] {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (p) {
    case 'this-year': return [localDay(new Date(y, 0, 1)), localDay(now)];
    case 'last-year': return [localDay(new Date(y - 1, 0, 1)), localDay(new Date(y - 1, 11, 31))];
    case 'last-12': return [localDay(new Date(y - 1, m, now.getDate() + 1)), localDay(now)];
    case 'last-month': return [localDay(new Date(y, m - 1, 1)), localDay(new Date(y, m, 0))];
  }
}

const PRESETS: Array<[Exclude<Preset, 'custom'>, string]> = [
  ['this-year', 'This year'],
  ['last-year', 'Last year'],
  ['last-12', 'Last 12 months'],
  ['last-month', 'Last month'],
];

/** Worker's "Income statement": completed payments over a chosen period, as a PDF with on-chain proof per line. */
export default function IncomeStatementButton({ workerId, workerEmail }: { workerId: string; workerEmail: string }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>('this-year');
  const [[from, to], setRange] = useState(() => presetRange('this-year'));
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const today = localDay(new Date());

  // Completed payments are loaded once per opening, so the count below updates as the period changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPayments(null);
    setLoadError('');
    listAllPayments({ workerId, status: 'completed' })
      .then((p) => { if (!cancelled) setPayments(p); })
      .catch((err) => { if (!cancelled) setLoadError(apiErrorMessage(err, 'Could not load your payments.')); });
    return () => { cancelled = true; };
  }, [open, workerId]);

  // Escape or a click outside closes the panel and returns focus to the button.
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); triggerRef.current?.focus(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  const valid = !!from && !!to && from <= to;
  const inPeriod = useMemo(() => {
    if (!payments || !valid) return [];
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    return payments
      .filter((p) => { const t = new Date(p.created_at); return t >= start && t <= end; })
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [payments, from, to, valid]);
  const payers = new Set(inPeriod.map((p) => p.company_name || 'Employer')).size;

  function choose(p: Exclude<Preset, 'custom'>) {
    setPreset(p);
    setRange(presetRange(p));
  }
  // Editing one end past the other moves the other end along (a later start runs to today, an earlier end pulls
  // the start back), so the range never turns invalid while someone is picking dates.
  function setDate(which: 0 | 1, value: string) {
    setPreset('custom');
    setRange(([f, t]) => {
      if (!value) return which === 0 ? [value, t] : [f, value];
      if (which === 0) return [value, t && value > t ? today : t];
      return [f && value < f ? value : f, value];
    });
  }

  async function download() {
    setBusy(true);
    try {
      const [xlmUsd, rates] = await Promise.all([getXlmPrice(), getFxRates()]);
      const usd = makeDisplayCurrency({ preferred: null, xlmUsd, rates });
      await generateIncomeStatement({
        workerEmail,
        from: new Date(`${from}T00:00:00`),
        to: new Date(`${to}T23:59:59.999`),
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

  let summary: string;
  if (loadError) summary = loadError;
  else if (!valid) summary = 'The start date must be on or before the end date.';
  else if (payments === null) summary = 'Counting payments…';
  else if (inPeriod.length === 0) summary = 'No completed payments in this period.';
  else summary = `${inPeriod.length} payment${inPeriod.length === 1 ? '' : 's'} from ${payers} employer${payers === 1 ? '' : 's'}`;

  const canDownload = valid && !busy && !loadError && inPeriod.length > 0;

  return (
    <div className="statement" ref={rootRef}>
      <button
        ref={triggerRef}
        className="btn-export"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <HiOutlineDocumentText size={14} /> Income statement
      </button>

      {open && (
        <div className="statement-panel" role="dialog" aria-labelledby="statement-title">
          <div className="statement-head">
            <div>
              <div id="statement-title" className="statement-title">Income statement</div>
              <div className="statement-sub">Completed payments in a period, each with its Stellar transaction.</div>
            </div>
            <button className="statement-close" onClick={() => setOpen(false)} aria-label="Close">
              <HiOutlineXMark size={16} />
            </button>
          </div>

          <div className="statement-presets" role="group" aria-label="Period">
            {PRESETS.map(([key, label]) => (
              <button
                key={key}
                className={`status-tab${preset === key ? ' active' : ''}`}
                aria-pressed={preset === key}
                onClick={() => choose(key)}
                autoFocus={preset === key}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="statement-dates">
            <label>
              <span>From</span>
              <div className="statement-date">
                <HiOutlineCalendar size={15} />
                <input type="date" value={from} max={to || today} onChange={(e) => setDate(0, e.target.value)} />
              </div>
            </label>
            <label>
              <span>To</span>
              <div className="statement-date">
                <HiOutlineCalendar size={15} />
                <input type="date" value={to} min={from} max={today} onChange={(e) => setDate(1, e.target.value)} />
              </div>
            </label>
          </div>

          <div className={`statement-summary${loadError || !valid ? ' is-error' : ''}`} aria-live="polite">{summary}</div>

          <button className="btn-primary statement-download" onClick={download} disabled={!canDownload}>
            <HiOutlineArrowDownTray size={16} /> {busy ? 'Building PDF…' : 'Download PDF'}
          </button>

          {!IS_MAINNET && (
            <div className="statement-note">Test network: the PDF is marked as not real money.</div>
          )}
        </div>
      )}
    </div>
  );
}
