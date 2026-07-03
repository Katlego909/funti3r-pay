import { useState, FormEvent, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';
import { HiOutlineFingerPrint } from 'react-icons/hi2';
import { registerPasskey } from '../api/auth.js';
import { api } from '../api/client.js';
import { useAuthStore } from '../store/authStore.js';

type Role = 'enterprise' | 'worker';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const initialRole: Role = searchParams.get('role') === 'worker' ? 'worker' : 'enterprise';
  const inviteToken = searchParams.get('invite') ?? '';
  const inviteEmail = searchParams.get('email') ?? '';

  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState(inviteEmail);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'passkey' | 'wallet'>('form');
  const [inviteValid, setInviteValid] = useState<boolean | null>(inviteToken ? null : true);

  useEffect(() => {
    if (!inviteToken) return;
    api.get(`/invites/${inviteToken}`)
      .then(() => setInviteValid(true))
      .catch(() => setInviteValid(false));
  }, [inviteToken]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStep('passkey');

    try {
      const session = await registerPasskey(email, role);
      setSession({ userId: session.userId, email: session.email, role: session.role }, session.accessToken);

      if (inviteToken && role === 'worker') {
        await api.post(`/invites/${inviteToken}/accept`, { workerId: session.userId }).catch(() => {});
      }

      navigate('/');
    } catch (err: unknown) {
      setStep('form');
      const msg = err instanceof Error ? err.message : 'Registration failed';
      if (msg.includes('409') || msg.includes('already registered')) {
        toast.error('This email is already registered. Please sign in.');
      } else if (msg.includes('cancelled') || msg.includes('NotAllowedError')) {
        toast.error('Passkey creation was cancelled. Please try again.');
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const stepMessages: Record<typeof step, string> = {
    form: '',
    passkey: 'Creating your passkey — follow your device prompt…',
    wallet: 'Setting up your Stellar wallet…',
  };

  return (
    <div className="auth-page">
      <Helmet>
        <title>Create Account | Funti3rPay</title>
        <meta name="description" content="Create a Funti3rPay account to pay African workers instantly in local currencies, or to receive payroll via passkey-secured Stellar wallets." />
      </Helmet>
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />

        <h2>Create account</h2>
        <p className="auth-subtitle">A passkey will be created on your device — no password required.</p>

        {inviteToken && inviteValid === false && (
          <p className="auth-error" style={{ marginBottom: '1rem' }}>
            This invite link has expired or is invalid. Ask your employer for a new one.
          </p>
        )}
        {inviteToken && inviteValid === true && (
          <p style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '10px 14px', fontSize: '0.85rem', color: '#065f46', margin: '0 0 1.25rem' }}>
            You've been invited to join as a worker. Your account will be linked to your employer automatically.
          </p>
        )}

        {!inviteToken && (
          <div className="role-toggle" role="group" aria-label="Account type">
            <button type="button" className={`role-toggle-btn ${role === 'enterprise' ? 'active' : ''}`} onClick={() => setRole('enterprise')} disabled={loading}>Enterprise</button>
            <button type="button" className={`role-toggle-btn ${role === 'worker' ? 'active' : ''}`} onClick={() => setRole('worker')} disabled={loading}>Worker</button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            {role === 'worker' ? 'Email' : 'Work email'}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === 'worker' ? 'you@email.com' : 'you@company.com'}
              required
              autoComplete="email"
              disabled={loading || (!!inviteToken && !!inviteEmail)}
            />
          </label>

          {step !== 'form' && <p className="auth-status">{stepMessages[step]}</p>}

          <button type="submit" className="btn-cta" disabled={loading || !email}>
            {loading ? stepMessages[step] || 'Working…' : 'Create account with Passkey'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
