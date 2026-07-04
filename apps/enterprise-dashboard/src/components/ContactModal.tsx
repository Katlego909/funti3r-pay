import { useEffect, useState } from 'react';
import { HiOutlineXMark, HiOutlineCheckCircle, HiOutlineArrowRight } from 'react-icons/hi2';
import { submitLead } from '../lib/leads.js';

interface ContactModalProps {
  /** Which form to show; null hides the modal. */
  intent: 'demo' | 'sales' | null;
  onClose: () => void;
}

const COPY = {
  demo: {
    eyebrow: 'Product demo',
    title: 'See it in action',
    sub: 'Tell us a bit about your team and we’ll set up a walkthrough.',
    cta: 'Request Demo',
  },
  sales: {
    eyebrow: 'Sales',
    title: 'Talk to sales',
    sub: 'A few details and our team will get back to you.',
    cta: 'Contact Sales',
  },
} as const;

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Germany',
  'France',
  'Netherlands',
  'United Arab Emirates',
  'Singapore',
  'Australia',
  'South Africa',
  'Nigeria',
  'Kenya',
  'Ghana',
  'Egypt',
  'India',
  'Other',
];

const TEAM_SIZES = ['1–10', '11–50', '51–200', '200+'];

export default function ContactModal({ intent, onClose }: ContactModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  const [country, setCountry] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [message, setMessage] = useState('');
  const [nickname, setNickname] = useState(''); // honeypot — real users never fill this
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  // Fresh form each time the modal opens
  useEffect(() => {
    if (intent) {
      setName('');
      setEmail('');
      setCompany('');
      setWebsite('');
      setCountry('');
      setTeamSize('');
      setMessage('');
      setNickname('');
      setStatus('idle');
    }
  }, [intent]);

  useEffect(() => {
    if (!intent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [intent, onClose]);

  if (!intent) return null;
  const copy = COPY[intent];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!intent || status === 'submitting') return;
    if (nickname) {
      // Honeypot tripped — swallow silently
      setStatus('success');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('error');
      return;
    }
    setStatus('submitting');
    const result = await submitLead({
      type: intent,
      name: name.trim() || undefined,
      email: email.trim(),
      company: company.trim() || undefined,
      website: website.trim() || undefined,
      country: country || undefined,
      team_size: teamSize || undefined,
      message: message.trim() || undefined,
    });
    setStatus(result === 'error' ? 'error' : 'success');
  }

  return (
    <div className="cm-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="cm-panel" onClick={(e) => e.stopPropagation()}>
        <button className="cm-close" onClick={onClose} aria-label="Close">
          <HiOutlineXMark size={22} />
        </button>

        {status === 'success' ? (
          <div className="cm-success">
            <HiOutlineCheckCircle size={40} />
            <h4>Request received</h4>
            <p>Thanks — we’ll be in touch at {email || 'your email'} shortly.</p>
            <button className="cm-submit" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="cm-head">
              <span className="cm-eyebrow">{copy.eyebrow}</span>
              <span className="hc-status">
                <span className="hc-dot" /> Replies in ~1 business day
              </span>
            </div>
            <h4>{copy.title}</h4>
            <p className="cm-sub">{copy.sub}</p>
            <form onSubmit={handleSubmit} noValidate>
              <div className="cm-grid">
                <div className="cm-field">
                  <label htmlFor="cm-name">Name</label>
                  <input
                    id="cm-name"
                    className="cm-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                  />
                </div>
                <div className="cm-field">
                  <label htmlFor="cm-company">Company</label>
                  <input
                    id="cm-company"
                    className="cm-input"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Company name"
                  />
                </div>
              </div>
              <div className="cm-field">
                <label htmlFor="cm-email">Work email *</label>
                <input
                  id="cm-email"
                  className="cm-input"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (status === 'error') setStatus('idle');
                  }}
                  placeholder="you@company.com"
                />
              </div>
              <div className="cm-field">
                <label htmlFor="cm-website">Website</label>
                <input
                  id="cm-website"
                  className="cm-input"
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://company.com"
                />
              </div>
              <div className="cm-grid">
                <div className="cm-field">
                  <label htmlFor="cm-country">Country</label>
                  <select
                    id="cm-country"
                    className="cm-input"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="cm-field">
                  <label htmlFor="cm-teamsize">Workers to pay</label>
                  <select
                    id="cm-teamsize"
                    className="cm-input"
                    value={teamSize}
                    onChange={(e) => setTeamSize(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {TEAM_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cm-field">
                <label htmlFor="cm-message">Anything we should know?</label>
                <textarea
                  id="cm-message"
                  className="cm-textarea"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Countries you pay into, timeline…"
                />
              </div>
              {/* Honeypot — hidden from real users */}
              <input
                className="cm-hp"
                tabIndex={-1}
                autoComplete="off"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="Nickname"
              />
              <button type="submit" className="cm-submit" disabled={status === 'submitting'}>
                {status === 'submitting' ? 'Sending…' : copy.cta}
                {status !== 'submitting' && <HiOutlineArrowRight size={16} />}
              </button>
              {status === 'error' && (
                <p className="cm-error">
                  {/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                    ? 'Something went wrong — please try again.'
                    : 'Enter a valid work email.'}
                </p>
              )}
            </form>
          </>
        )}
      </div>
    </div>
  );
}
