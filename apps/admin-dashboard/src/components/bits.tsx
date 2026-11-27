/** Small building blocks the admin pages share: a section card, a table, a status pill, an ID with copy, a value list. */
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CopyButton, Delayed, EmptyState, ErrorState, EXPLORER, SkeletonCards, SkeletonLines, SkeletonTable, StatusBadge, type EmptyStateProps,
} from '@funti3r/ui';
import type { Loaded } from '@funti3r/web-core';
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

/**
 * A data table. With `onRowClick`, a row opens its details (a drawer, as the dashboards do); clicks on a link or button
 * inside the row still do their own thing.
 */
export function Table<T>({ rows, columns, empty = 'Nothing here.', rowKey, onRowClick, refreshing = false }: {
  rows: T[] | undefined; columns: Column<T>[]; rowKey: (row: T, i: number) => string;
  /** What an empty table says: a title, or a title with a line saying what will appear there. */
  empty?: string | EmptyStateProps;
  onRowClick?: (row: T) => void;
  /** New rows are loading (a filter changed, a refresh): the current ones stay, dimmed, instead of blanking. */
  refreshing?: boolean;
}) {
  if (!rows?.length) return <EmptyState {...(typeof empty === 'string' ? { title: empty } : empty)} />;
  return (
    <div className={`table-responsive${refreshing ? ' is-refreshing' : ''}`} aria-busy={refreshing}>
      <table className="data-table">
        <thead><tr>{columns.map((c) => <th key={c.label} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className={onRowClick ? 'admin-row-clickable' : undefined}
              onClick={onRowClick ? (e) => { if (!(e.target as HTMLElement).closest('a, button, input')) onRowClick(row); } : undefined}
            >
              {columns.map((c) => <td key={c.label}>{c.render(row)}</td>)}
            </tr>
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

/** Newer / older buttons under a list, with which rows are shown and, when known, how many there are. */
export function Pager({ offset, shown, pageSize, total, onPage }: {
  offset: number; shown: number; pageSize: number; total?: number; onPage: (offset: number) => void;
}) {
  const last = total !== undefined ? offset + shown >= total : shown < pageSize;
  if (!shown && offset === 0) return null; // an empty list needs no pager
  return (
    <div className="admin-pager">
      <button className="btn-secondary" disabled={offset === 0} onClick={() => onPage(Math.max(offset - pageSize, 0))}>Newer</button>
      <span className="admin-muted">
        {shown ? `${offset + 1}–${offset + shown}` : '0'}{total !== undefined ? ` of ${total.toLocaleString()}` : ''}
      </span>
      <button className="btn-secondary" disabled={last} onClick={() => onPage(offset + pageSize)}>Older</button>
    </div>
  );
}

/** A text filter applied on Enter (or Filter), with Clear once something is applied. */
export function FilterInput({ value, placeholder, onApply }: { value: string; placeholder: string; onApply: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const submit = (e: FormEvent) => { e.preventDefault(); onApply(draft.trim()); };
  return (
    <form onSubmit={submit} className="admin-filter-search">
      <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      <button className="btn-secondary" type="submit">Filter</button>
      {value && <button className="btn-secondary" type="button" onClick={() => onApply('')}>Clear</button>}
    </form>
  );
}

/** Tabs across the top of a list (the dashboard's status tabs), each with an optional count. */
export function Tabs<T extends string>({ tabs, active, onChange }: {
  tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (key: T) => void;
}) {
  return (
    <div className="payments-status-tabs">
      {tabs.map((t) => (
        <button key={t.key} className={`status-tab${active === t.key ? ' active' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}{t.count !== undefined ? ` (${t.count.toLocaleString()})` : ''}
        </button>
      ))}
    </div>
  );
}

/**
 * A section's loading and failure states (the shared ones from @funti3r/ui): a skeleton shaped like the content on
 * the first load, an ErrorState with Retry in its place when it failed. Once there is data it renders nothing, and a
 * failed refresh keeps the data on screen with a compact error above it.
 */
export function LoadState({ state, skeleton = 'table' }: {
  state: Pick<Loaded<unknown>, 'data' | 'error' | 'errorKind' | 'loading' | 'reload'>;
  skeleton?: 'table' | 'cards' | 'lines';
}) {
  if (state.error) {
    return <ErrorState message={state.error} kind={state.errorKind} onRetry={() => void state.reload()} compact={state.data !== null} />;
  }
  if (state.loading) {
    return (
      <Delayed>
        {skeleton === 'cards' ? <SkeletonCards /> : skeleton === 'lines' ? <SkeletonLines /> : <SkeletonTable />}
      </Delayed>
    );
  }
  return null;
}
