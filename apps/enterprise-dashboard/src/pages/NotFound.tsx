import { Link, useLocation } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import PublicPageNav from '../components/PublicPageNav.js';

/** Shown for any URL no route matches. Signed-out visitors get the public header; inside the app the shell is already there. */
export default function NotFound({ publicNav = false }: { publicNav?: boolean }) {
  const { pathname } = useLocation();

  return (
    <div style={publicNav ? { minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' } : undefined}>
      <Helmet>
        <title>Page not found | Funti3rPay</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      {publicNav && <PublicPageNav />}

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '96px 24px', textAlign: 'center' }}>
        <p style={{ fontSize: '0.85rem', fontWeight: 600, color: '#2563eb', margin: '0 0 8px' }}>404</p>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>Page not found</h1>
        <p style={{ fontSize: '0.97rem', color: '#4b5563', lineHeight: 1.75, margin: '0 0 32px', wordBreak: 'break-word' }}>
          There is nothing at <code>{pathname}</code>. The link may be mistyped or the page may have moved.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/" className="btn btn-primary">{publicNav ? 'Go to home' : 'Go to dashboard'}</Link>
          <Link to="/help" className="btn btn-secondary">Help center</Link>
        </div>
      </div>
    </div>
  );
}
