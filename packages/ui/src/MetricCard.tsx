import { ElementType, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export type MetricAccent = 'orange' | 'green' | 'purple' | 'warning' | 'blue';

interface MetricCardProps {
  icon: ElementType;
  label: string;
  /** The figure; a dash while it is unknown. */
  value?: ReactNode;
  /** The line under the figure. */
  note?: ReactNode;
  /** Colours the note: negative for something that needs attention, positive for good news. */
  noteTone?: 'positive' | 'negative' | 'neutral';
  /** The icon's colour. */
  accent: MetricAccent;
  /** Makes the whole card a link to where the figure comes from. */
  to?: string;
}

/** One headline figure in a row of cards (`.metrics-grid`): icon, label, value and a note, as every dashboard shows them. */
export default function MetricCard({ icon: Icon, label, value, note, noteTone, accent, to }: MetricCardProps) {
  const card = (
    <div className="metric-card" data-accent={accent}>
      <div className="metric-header">
        <span className="metric-icon"><Icon size={18} /></span>
        <h3>{label}</h3>
      </div>
      <div className="metric-value">{value ?? '—'}</div>
      {note !== undefined && note !== null && note !== false && (
        <div className={`metric-change${noteTone ? ` ${noteTone}` : ''}`}>{note}</div>
      )}
    </div>
  );
  return to ? <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>{card}</Link> : card;
}
