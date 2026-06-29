import { useEffect, useState, FormEvent } from 'react';
import { HiOutlineArrowTopRightOnSquare } from 'react-icons/hi2';
import { listPayments, initiatePayment, getQuotes, type Payment, type Quote } from '../api/payments.js';
import { useAuthStore } from '../store/authStore.js';
import WalletLinking from '../components/WalletLinking.js';
import WalletSelector, { type Wallet } from '../components/WalletSelector.js';
import ExternalWalletSigningModal from '../components/ExternalWalletSigningModal.js';

function statusClass(s: string) {
  if (s === 'completed') return 'completed';
  if (s === 'failed') return 'failed';
  return 'pending';
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN', 'KES', 'GHS', 'ZAR', 'XLM'];
const COUNTRIES = [
  { code: 'US', name: 'United States' }, { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' }, { code: 'GH', name: 'Ghana' },
  { code: 'ZA', name: 'South Africa' }, { code: 'MX', name: 'Mexico' },
  { code: 'CO', name: 'Colombia' }, { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' }, { code: 'IN', name: 'India' },
  { code: 'GB', name: 'United Kingdom' }, { code: 'DE', name: 'Germany' },
];

export default function Payments() {
  const user = useAuthStore((s) => s.user);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // New payment form state
  const [formOpen, setFormOpen] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [country, setCountry] = useState('NG');
  const [recipientName, setRecipientName] = useState('');
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Wallet kit state
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [signingModalOpen, setSigningModalOpen] = useState(false);
  const [pendingPaymentId, setPendingPaymentId] = useState('');
  const [unsignedXDR, setUnsignedXDR] = useState('');
  const [signerProvider, setSignerProvider] = useState('');
  const [platformWallet, setPlatformWallet] = useState<Wallet | null>(null);

  const PAGE = 15;

  function loadPayments() {
    if (!user) return;
    setLoading(true);
    listPayments({ enterpriseId: user.userId, limit: PAGE, offset })
      .then(({ payments: p, total: t }) => { setPayments(p); setTotal(t); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function loadPlatformWallet() {
    if (!user?.userId) return;
    try {
      const response = await fetch(`/api/wallets/${user.userId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.address) {
          setPlatformWallet({
            id: user.userId,
            publicKey: data.address,
            status: data.status || 'active',
          });
        }
      }
    } catch (err) {
      console.error('Failed to load platform wallet:', err);
    }
  }

  useEffect(() => {
    loadPayments();
    loadPlatformWallet();
  }, [user, offset]);

  async function fetchQuotes() {
    if (!amount || isNaN(Number(amount))) return;
    setQuotes([]);
    setSelectedQuote(null);
    try {
      const q = await getQuotes({ amount: Number(amount), sourceCurrency: currency, destinationCurrency: currency, destinationCountry: country });
      setQuotes(q);
      if (q.length > 0) setSelectedQuote(q[0]);
    } catch { /* non-fatal */ }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setSubmitting(true);
    try {
      const result = await initiatePayment({
        enterpriseId: user!.userId,
        workerId,
        amount: Number(amount),
        currency,
        destinationCountry: country,
        idempotencyKey: crypto.randomUUID(),
        preferFiat: selectedQuote?.rail !== 'stellar',
        quoteId: selectedQuote?.quoteId,
        recipientName: recipientName || undefined,
        signerWalletId: selectedWalletId || undefined,
      });

      // Check if external wallet signing is needed (HTTP 202)
      if (result.status === 'pending_signature') {
        setPendingPaymentId(result.paymentId);
        setUnsignedXDR(result.unsignedXDR);
        setSignerProvider(result.walletProvider);
        setSigningModalOpen(true);
        return;
      }

      // Platform wallet path (existing flow)
      setFormSuccess(`Payment submitted — ${result.rail} — ${result.status}`);
      setFormOpen(false);
      loadPayments();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Payment failed';
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h2>Payments</h2>
          <p className="subtitle">Manage cross-border workforce payouts</p>
        </div>
        <button className="btn-primary" onClick={() => { setFormOpen(true); setFormSuccess(''); setFormError(''); }}>
          + New Payment
        </button>
      </div>

      {formSuccess && <div className="success-banner">{formSuccess}</div>}

      <WalletLinking userId={user!.userId} onLinked={() => loadPayments()} />

      {formOpen && (
        <div className="modal-overlay" onClick={() => setFormOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New Payment</h3>
            <form onSubmit={handleSend} className="payment-form">
              {/* Wallet Selection Section */}
              <div className="wallet-section">
                <WalletSelector
                  userId={user!.userId}
                  onSelect={(wallet) => setSelectedWalletId(wallet.id)}
                  selectedWalletId={selectedWalletId}
                  defaultPlatformWallet={platformWallet || undefined}
                />
              </div>
              <label>Worker ID (UUID)
                <input value={workerId} onChange={(e) => setWorkerId(e.target.value)} required placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </label>
              <label>Recipient Name (optional)
                <input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Full name for fiat rails" />
              </label>
              <div className="form-row">
                <label>Amount
                  <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required onBlur={fetchQuotes} />
                </label>
                <label>Currency
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              <label>Destination Country
                <select value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
              </label>

              {quotes.length > 0 && (
                <fieldset className="quote-options">
                  <legend>Available Rails</legend>
                  {quotes.map((q) => (
                    <label key={q.rail} className="quote-option">
                      <input type="radio" name="rail" value={q.rail} checked={selectedQuote?.rail === q.rail} onChange={() => setSelectedQuote(q)} />
                      <span className="quote-name">{q.rail}</span>
                      <span className="quote-fee">Fee: {q.fee} {q.sourceCurrency}</span>
                      <span className="quote-eta">~{q.estimatedDeliveryMinutes} min</span>
                    </label>
                  ))}
                </fieldset>
              )}

              {formError && <p className="auth-error">{formError}</p>}
              <div className="form-actions">
                <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Sending…' : 'Send Payment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading payments…</div>
      ) : error ? (
        <div className="error-banner">{error}</div>
      ) : (
        <section className="section">
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Worker</th><th>Amount</th><th>Rail</th><th>Status</th><th>Date</th><th></th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>No payments found.</td></tr>
              ) : payments.map((p) => (
                <tr key={p.id}>
                  <td>#{p.id.slice(0, 8)}</td>
                  <td>{p.worker_email ?? p.worker_id.slice(0, 8)}</td>
                  <td>{p.amount} {p.currency}</td>
                  <td>{p.rail ?? 'stellar'}</td>
                  <td><span className={`status ${statusClass(p.status)}`}>{p.status}</span></td>
                  <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  <td>
                    {p.stellar_tx_hash && (
                      <a href={`https://stellar.expert/explorer/testnet/tx/${p.stellar_tx_hash}`} target="_blank" rel="noopener noreferrer">
                        <HiOutlineArrowTopRightOnSquare size={14} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>← Prev</button>
            <span>{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
            <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next →</button>
          </div>
        </section>
      )}

      {/* Signing Modal (For external wallet transactions) */}
      <ExternalWalletSigningModal
        isOpen={signingModalOpen}
        paymentId={pendingPaymentId}
        unsignedXDR={unsignedXDR}
        walletProvider={signerProvider}
        onClose={() => setSigningModalOpen(false)}
        onSuccess={(txHash) => {
          setSigningModalOpen(false);
          setFormSuccess(`Payment submitted with tx: ${txHash.substring(0, 16)}...`);
          setFormOpen(false);
          loadPayments();
        }}
      />
    </div>
  );
}
