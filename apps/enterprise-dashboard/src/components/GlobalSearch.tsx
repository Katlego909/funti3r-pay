import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiOutlineArrowPathRoundedSquare, HiOutlineUsers } from 'react-icons/hi2';
import { api, useAuthStore } from '@funti3r/web-core';
import { SearchBox } from '@funti3r/ui';
import { listPayments, type Payment } from '../api/payments.js';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency.js';

interface WorkerResult { id: string; email: string; role: string; preferred_currency?: string }
interface SearchResults {
  workers: WorkerResult[];
  payments: Payment[];
}

const EMPTY: SearchResults = { workers: [], payments: [] };

export default function GlobalSearch() {
  const dc = useDisplayCurrency();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || !user) { setResults(EMPTY); return; }
    setLoading(true);
    try {
      const [workersRes, paymentsRes] = await Promise.allSettled([
        api.get<{ users: WorkerResult[] }>(`/users?role=worker&search=${encodeURIComponent(q)}&limit=5`),
        listPayments({ limit: 50, offset: 0 }),
      ]);

      const workers = workersRes.status === 'fulfilled' ? workersRes.value.data.users ?? [] : [];

      let payments: Payment[] = [];
      if (paymentsRes.status === 'fulfilled') {
        const lq = q.toLowerCase();
        payments = paymentsRes.value.payments
          .filter(
            (p) =>
              p.id.toLowerCase().includes(lq) ||
              (p.worker_email ?? '').toLowerCase().includes(lq) ||
              String(p.amount).includes(lq) ||
              p.currency.toLowerCase().includes(lq) ||
              p.status.toLowerCase().includes(lq),
          )
          .slice(0, 5);
      }

      setResults({ workers, payments });
    } finally {
      setLoading(false);
    }
  }, [user]);

  const hasResults = results.workers.length > 0 || results.payments.length > 0;

  return (
    <SearchBox placeholder="Search payments, workers…" onQuery={search}>
      {({ query, close }) => (
        <>
          {loading && <div className="gs-status">Searching…</div>}

          {!loading && !hasResults && (
            <div className="gs-status gs-empty">No results for "{query}"</div>
          )}

          {results.workers.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-label"><HiOutlineUsers size={12} /> Workers</div>
              {results.workers.map((w) => (
                <button key={w.id} className="gs-item" onClick={() => { close(); navigate(`/workers?highlight=${w.id}`); }}>
                  <span className="gs-item-avatar">{w.email.slice(0, 2).toUpperCase()}</span>
                  <span className="gs-item-main">
                    <span className="gs-item-title">{w.email}</span>
                    <span className="gs-item-sub">{w.preferred_currency ?? 'USDC'} · {w.id.slice(0, 8)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.payments.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-label"><HiOutlineArrowPathRoundedSquare size={12} /> Payments</div>
              {results.payments.map((p) => (
                <button key={p.id} className="gs-item" onClick={() => { close(); navigate(`/payments?highlight=${p.id}`); }}>
                  <span className={`gs-item-dot gs-dot-${p.status === 'completed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}`} />
                  <span className="gs-item-main">
                    <span className="gs-item-title">#{p.id.slice(0, 8)} · {dc.format(Number(p.amount), p.currency)}</span>
                    <span className="gs-item-sub">{p.worker_email ?? p.worker_id.slice(0, 8)} · {p.status}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </SearchBox>
  );
}
