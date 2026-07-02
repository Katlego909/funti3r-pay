import { useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineEnvelope, HiOutlineCheckCircle } from 'react-icons/hi2';
import { toast } from 'sonner';
import { requestRecoveryLink } from '../api/auth.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

export default function RecoveryStart() {
  useDocumentTitle('Sign in on a new device');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await requestRecoveryLink(email);
      setSent(true);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />

        {sent ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <HiOutlineCheckCircle size={40} style={{ color: 'var(--success)' }} />
            </div>
            <h2>Check your email</h2>
            <p className="auth-subtitle">
              We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes.
            </p>
            <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginTop: '16px', textAlign: 'center', lineHeight: 1.6 }}>
              Didn't get it? Check your spam folder or{' '}
              <button
                onClick={() => setSent(false)}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontWeight: 600, fontSize: '13px', padding: 0 }}
              >
                try again
              </button>.
            </p>
          </>
        ) : (
          <>
            <h2>New device sign-in</h2>
            <p className="auth-subtitle">
              Enter your email and we'll send you a one-time link to sign in and re-register your passkey.
            </p>

            <form onSubmit={handleSubmit} className="auth-form">
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoComplete="email"
                  autoFocus
                />
              </label>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading || !email}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
              >
                <HiOutlineEnvelope size={17} />
                {loading ? 'Sending…' : 'Send sign-in link'}
              </button>
            </form>
          </>
        )}

        <p className="auth-link" style={{ marginTop: '24px' }}>
          <Link to="/login">← Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
