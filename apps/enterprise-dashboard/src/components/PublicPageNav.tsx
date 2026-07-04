import { Link } from 'react-router-dom';

/** Slim header shared by public standalone pages (legal, help center). */
export default function PublicPageNav() {
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <img src="/images/logo.png" alt="Funti3rPay" style={{ height: 26, width: 'auto', imageRendering: '-webkit-optimize-contrast' }} />
        </Link>
        <Link to="/" state={{ scrollToFooter: true }} style={{ fontSize: '0.85rem', color: '#6b7280', textDecoration: 'none' }}>← Back to home</Link>
      </div>
    </div>
  );
}
