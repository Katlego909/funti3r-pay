/**
 * How every Funti3rPay screen shows its states, the same in every app:
 * - first load: skeletons shaped like what is coming (the page's header and layout are already there), shown only
 *   after a short delay so a fast load doesn't flash;
 * - refresh: the old data stays, and the refresh button spins;
 * - nothing there: an EmptyState that says so and offers the obvious next step;
 * - failure: an ErrorState where the content would be, worded for the kind of failure, with Retry.
 * Toasts are for the outcome of something the user just did, not for a screen that could not load.
 */
import { CSSProperties, ElementType, ReactNode, useEffect, useState } from 'react';
import {
  HiOutlineArrowPath, HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineInboxStack, HiOutlineLockClosed,
  HiOutlineSignalSlash,
} from 'react-icons/hi2';

/** Shows its children only after `ms`: a load that finishes sooner never flashes a placeholder. */
export function Delayed({ ms = 150, children }: { ms?: number; children: ReactNode }) {
  const [show, setShow] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) return;
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

/** One shimmering placeholder block. */
export function Skeleton({ width = '100%', height = 14, radius = 6, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: CSSProperties;
}) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden="true" />;
}

/** A few lines of text still loading. */
export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="skeleton-lines" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} width={i === count - 1 ? '60%' : '100%'} />)}
    </div>
  );
}

/** A row of metric cards still loading (the dashboards' headline figures). */
export function SkeletonCards({ count = 5 }: { count?: number }) {
  return (
    <div className="metrics-grid" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="metric-card">
          <Skeleton width={36} height={36} radius={9} style={{ marginBottom: 12 }} />
          <Skeleton width="55%" height={13} style={{ marginBottom: 10 }} />
          <Skeleton width="70%" height={26} />
        </div>
      ))}
    </div>
  );
}

/** A table still loading: a header and a few rows, so the page keeps its shape. */
export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-table" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows + 1 }, (_, r) => (
        <div key={r} className="skeleton-row" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} width={r === 0 ? '50%' : `${60 + ((r * 7 + c * 13) % 35)}%`} height={r === 0 ? 10 : 13} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A whole page still loading: what a lazily loaded screen shows while its code arrives. */
export function SkeletonPage() {
  return (
    <Delayed ms={200}>
      <div className="dashboard" aria-busy="true" aria-label="Loading">
        <div className="dashboard-header">
          <div style={{ width: '100%' }}>
            <Skeleton width={220} height={26} style={{ marginBottom: 10 }} />
            <Skeleton width={320} height={14} />
          </div>
        </div>
        <SkeletonCards count={4} />
        <div className="section"><SkeletonTable /></div>
      </div>
    </Delayed>
  );
}

export interface EmptyStateProps {
  title: string;
  /** What will appear here, or where else to look. */
  message?: ReactNode;
  /** The obvious next step (a button or link). */
  action?: ReactNode;
  icon?: ElementType;
  /** 'clear' is good news ("nothing stuck", "nobody flagged"): a green check instead of an empty tray. */
  tone?: 'neutral' | 'clear';
  /** A small inline version for tight spots (inside a drawer), not a page's main content. */
  compact?: boolean;
}

/** Nothing to show: centred, with a title, a line saying what will appear here, and the next step when there is one. */
export function EmptyState({ title, message, action, icon, tone = 'neutral', compact = false }: EmptyStateProps) {
  const Icon = icon ?? (tone === 'clear' ? HiOutlineCheckCircle : HiOutlineInboxStack);
  return (
    <div className={`state-empty${compact ? ' compact' : ''}${tone === 'clear' ? ' clear' : ''}`}>
      <span className="state-icon"><Icon size={compact ? 18 : 26} /></span>
      <div className="state-text">
        <div className="state-title">{title}</div>
        {message && <div className="state-message">{message}</div>}
        {action && <div className="state-action">{action}</div>}
      </div>
    </div>
  );
}

export type StateErrorKind = 'offline' | 'forbidden' | 'notFound' | 'server' | 'other';

const ERROR_WORDING: Record<StateErrorKind, { title: string; icon: ElementType }> = {
  offline: { title: "You're offline", icon: HiOutlineSignalSlash },
  forbidden: { title: "You don't have access to this", icon: HiOutlineLockClosed },
  notFound: { title: "This doesn't exist (any more)", icon: HiOutlineExclamationTriangle },
  server: { title: 'Something went wrong on our side', icon: HiOutlineExclamationTriangle },
  other: { title: "This couldn't load", icon: HiOutlineExclamationTriangle },
};

/** A part of the screen that failed to load, in its place: what went wrong and a Retry. */
export function ErrorState({ message, kind = 'other', onRetry, compact = false }: {
  message?: string | null; kind?: StateErrorKind | null; onRetry?: () => void; compact?: boolean;
}) {
  const { title, icon: Icon } = ERROR_WORDING[kind ?? 'other'];
  const retryable = kind !== 'forbidden' && kind !== 'notFound';
  return (
    <div className={`state-error${compact ? ' compact' : ''}`} role="alert">
      <span className="state-icon"><Icon size={compact ? 18 : 22} /></span>
      <div>
        <div className="state-title">{title}</div>
        {message && <div className="state-message">{message}</div>}
        {onRetry && retryable && (
          <button type="button" className="btn-secondary state-retry" onClick={onRetry}>
            <HiOutlineArrowPath size={14} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

/** A Refresh button that spins while the screen reloads in the background (the data stays on screen). */
export function RefreshButton({ onClick, refreshing, label = 'Refresh' }: { onClick: () => void; refreshing: boolean; label?: string }) {
  return (
    <button type="button" className="btn-secondary refresh-button" onClick={onClick} disabled={refreshing} aria-busy={refreshing}>
      <HiOutlineArrowPath size={15} className={refreshing ? 'spin' : undefined} /> {refreshing ? 'Refreshing…' : label}
    </button>
  );
}
