import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HiOutlineBuildingOffice2, HiOutlineUsers } from 'react-icons/hi2';
import { SearchBox } from '@funti3r/ui';
import { admin, type Row } from '../api';

/**
 * The top bar's search across the whole platform: matching accounts and companies as you type, and Enter for the full
 * results page (which also finds payments and escrows by id or transaction hash).
 */
export default function AdminSearch() {
  const navigate = useNavigate();
  const [results, setResults] = useState<{ users: Row[]; companies: Row[] }>({ users: [], companies: [] });
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults({ users: [], companies: [] }); return; }
    setLoading(true);
    try {
      setResults(await admin.search(q));
    } catch {
      setResults({ users: [], companies: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const users = results.users.slice(0, 5);
  const companies = results.companies.slice(0, 5);

  return (
    <SearchBox
      placeholder="Search accounts, companies, payments, tx hashes…"
      onQuery={search}
      onSubmit={(q) => navigate(`/search?q=${encodeURIComponent(q)}`)}
    >
      {({ query, close }) => (
        <>
          {loading && <div className="gs-status">Searching…</div>}
          {!loading && !users.length && !companies.length && (
            <div className="gs-status gs-empty">No accounts or companies match "{query}". Press Enter to search payments too.</div>
          )}
          {users.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-label"><HiOutlineUsers size={12} /> Accounts</div>
              {users.map((u) => (
                <button key={u.id} className="gs-item" onClick={() => { close(); navigate(`/accounts/${u.id}`); }}>
                  <span className="gs-item-avatar">{String(u.email).slice(0, 2).toUpperCase()}</span>
                  <span className="gs-item-main">
                    <span className="gs-item-title">{u.email}</span>
                    <span className="gs-item-sub">{u.role} · {u.status}{u.company_name ? ` · ${u.company_name}` : ''}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {companies.length > 0 && (
            <div className="gs-section">
              <div className="gs-section-label"><HiOutlineBuildingOffice2 size={12} /> Companies</div>
              {companies.map((c) => (
                <button key={c.id} className="gs-item" onClick={() => { close(); navigate(`/companies/${c.id}`); }}>
                  <span className="gs-item-avatar">{String(c.company_name).slice(0, 2).toUpperCase()}</span>
                  <span className="gs-item-main">
                    <span className="gs-item-title">{c.company_name}</span>
                    <span className="gs-item-sub">{c.members} members · {c.workers} workers · {c.owner_email}</span>
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
