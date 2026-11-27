/** Small building blocks the admin pages share: a section card, a table, a status pill, an ID with copy, a value list. */
import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CopyButton, EXPLORER, StatusBadge } from '@funti3r/ui';
import { short } from '../format';

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="section admin-section">
      {(title || actions) && (
        <div className="admin-section-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="admin-section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export interface Column<T> { label: string; render: (row: T) => ReactNode; width?: string }

export function Table<T>({ rows, columns, empty = 'Nothing here.', rowKey }: {
  rows: T[] | undefined; columns: Column<T>[]; empty?: string; rowKey: (row: T, i: number) => string;
}) {
  if (!rows?.length) return <p className="admin-empty">{empty}</p>;
  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead><tr>{columns.map((c) => <th key={c.label} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)}>{columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Tone = 'good' | 'bad' | 'warn';
const TONE: Record<string, Tone> = {
  active: 'good', completed: 'good', approved: 'good', verified: 'good', ready: 'good', clear: 'good', accepted: 'good',
  suspended: 'bad', failed: 'bad', rejected: 'bad', unavailable: 'bad', unreachable: 'bad', flagged: 'bad', frozen: 'bad',
};
const VARIANT = { good: 'completed', bad: 'failed', warn: 'pending' } as const;

/** A status as the dashboard shows one (its status badge): green when done or fine, red when failed or held, amber otherwise. */
export function Pill({ value, tone }: { value: string | null | undefined; tone?: Tone }) {
  const label = value ? value.replace(/_/g, ' ') : 'none';
  return <StatusBadge variant={VARIANT[tone ?? (value ? TONE[value] : undefined) ?? 'warn']} style={{ textTransform: 'capitalize' }}>{label}</StatusBadge>;
}

/** An id or address shortened, with the full value on hover and a copy button. */
export function Id({ value, keep }: { value: string | null | undefined; keep?: number }) {
  if (!value) return <span className="admin-muted">—</span>;
  return <span className="admin-id" title={value}><code>{short(value, keep)}</code><CopyButton text={value} /></span>;
}

/** A transaction hash linked to the Stellar explorer. */
export function Tx({ hash }: { hash: string | null | undefined }) {
  if (!hash) return <span className="admin-muted">—</span>;
  return <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer" title={hash}><code>{short(hash)}</code></a>;
}

/** An account, linked to its detail page. */
export function AccountLink({ id, email }: { id: string | null | undefined; email?: string | null }) {
  if (!id) return <span className="admin-muted">{email ?? '—'}</span>;
  return <Link to={`/accounts/${id}`}>{email ?? short(id)}</Link>;
}

/** Label / value pairs, two columns wide. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="admin-facts">
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>
      ))}
    </dl>
  );
}

export function LoadState({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <div className="error-banner">{error}</div>;
  if (loading) return <p className="admin-muted">Loading…</p>;
  return null;
}
