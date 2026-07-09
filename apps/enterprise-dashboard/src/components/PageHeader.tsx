import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Standard page header: title/subtitle on the left, action buttons on the right. */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="dashboard-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions && (
        // No alignItems — children stretch to the tallest button so every
        // button in the row shares one height. Don't "fix" this by centering.
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{actions}</div>
      )}
    </div>
  );
}
