import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HiOutlineMagnifyingGlass,
  HiOutlineXMark,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineUsers,
  HiOutlineCommandLine,
} from 'react-icons/hi2';
import { api } from '../api/client.js';
import { listPayments, type Payment } from '../api/payments.js';
import { useAuthStore } from '../store/authStore.js';

interface WorkerResult { id: string; email: string; role: string; preferred_currency?: string }
interface SearchResults {
  workers: WorkerResult[];
  payments: Payment[];
}

const EMPTY: SearchResults = { workers: [], payments: [] };

function useDebounce(value: string, ms: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debouncedValue;
}

export default function GlobalSearch() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 280);

  // Cmd/Ctrl+K to focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside to close
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim() || !user) { setResults(EMPTY); return; }
    setLoading(true);
    try {
      const [workersRes, paymentsRes] = await Promise.allSettled([
        api.get<{ users: WorkerResult[] }>(`/users?role=worker&search=${encodeURIComponent(q)}&limit=5`),
        listPayments({ enterpriseId: user.userId, limit: 50, offset: 0 }),
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

  useEffect(() => {
    search(debouncedQuery);
  }, [debouncedQuery, search]);

  const hasResults = results.workers.length > 0 || results.payments.length > 0;
  const showDropdown = open && query.trim().length > 0;

  function goToPayment(p: Payment) {
    setOpen(false);
    setQuery('');
    navigate(`/payments?highlight=${p.id}`);
  }

  function goToWorker(w: WorkerResult) {
    setOpen(false);
    setQuery('');
    navigate(`/workers?highlight=${w.id}`);
  }

  return (
    <div className="global-search" ref={containerRef}>
      <div className={`gs-input-wrap ${open ? 'focused' : ''}`}>
        <HiOutlineMagnifyingGlass size={15} className="gs-icon" />
        <input
          ref={inputRef}
          className="gs-input"
          placeholder="Search payments, workers…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button className="gs-clear" onClick={() => { setQuery(''); setResults(EMPTY); inputRef.current?.focus(); }}>
            <HiOutlineXMark size={13} />
          </button>
        ) : (
          <kbd className="gs-kbd">⌘K</kbd>
        )}
      </div>

      {showDropdown && (
        <div className="gs-dropdown">
          {loading && <div className="gs-status">Searching…</div>}

          {!loading && !hasResults && (
            <div className="gs-status gs-empty">No results for "{query}"</div>
          )}

          {results.workers.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-label"><HiOutlineUsers size={12} /> Workers</div>
              {results.workers.map((w) => (
                <button key={w.id} className="gs-item" onClick={() => goToWorker(w)}>
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
                <button key={p.id} className="gs-item" onClick={() => goToPayment(p)}>
                  <span className={`gs-item-dot gs-dot-${p.status === 'completed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'}`} />
                  <span className="gs-item-main">
                    <span className="gs-item-title">#{p.id.slice(0, 8)} · {p.amount} {p.currency}</span>
                    <span className="gs-item-sub">{p.worker_email ?? p.worker_id.slice(0, 8)} · {p.status}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="gs-footer">
            <HiOutlineCommandLine size={11} /> Esc to close
          </div>
        </div>
      )}
    </div>
  );
}
