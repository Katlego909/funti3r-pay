import { useEffect } from 'react';
import PublicPageNav from './PublicPageNav.js';

interface Section {
  heading: string;
  content: React.ReactNode;
}

export default function LegalLayout({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro?: string;
  sections: Section[];
}) {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <PublicPageNav />

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '52px 24px 96px' }}>
        <p style={{ fontSize: '0.78rem', color: '#9ca3af', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Last updated: {updated}
        </p>
        <h1 style={{ fontSize: '1.9rem', fontWeight: 700, color: '#111827', margin: '0 0 20px', lineHeight: 1.2 }}>
          {title}
        </h1>
        {intro && (
          <p style={{ fontSize: '0.97rem', color: '#4b5563', lineHeight: 1.75, margin: '0 0 36px', paddingBottom: '28px', borderBottom: '1px solid #e5e7eb' }}>
            {intro}
          </p>
        )}

        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom: '36px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#111827', margin: '0 0 10px' }}>
              {i + 1}. {s.heading}
            </h2>
            <div style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.8 }}>
              {s.content}
            </div>
          </div>
        ))}

        <div style={{ marginTop: '56px', paddingTop: '24px', borderTop: '1px solid #e5e7eb', fontSize: '0.82rem', color: '#9ca3af' }}>
          Questions? Contact us at{' '}
          <a href="mailto:legal@funti3r.xyz" style={{ color: '#6b7280' }}>legal@funti3r.xyz</a>
        </div>
      </div>
    </div>
  );
}
