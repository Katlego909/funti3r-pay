import { useState, FormEvent } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { registerPasskey } from '../api/auth.js';
import { useAuthStore } from '../store/authStore.js';

type Role = 'enterprise' | 'worker';

export default function Register() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const initialRole: Role = searchParams.get('role') === 'worker' ? 'worker' : 'enterprise';
  const [role, setRole] = useState<Role>(initialRole);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'form' | 'passkey' | 'wallet'>('form');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStep('passkey');

    try {
      console.log('[Register] Starting passkey registration for:', email, 'as', role);
      const session = await registerPasskey(email, role);
      console.log('[Register] Passkey registration succeeded:', session.userId);
      setSession({ userId: session.userId, email: session.email, role: session.role }, session.accessToken);

      // TODO: Create enterprise wallet when endpoint is ready
      // setStep('wallet');
      // console.log('[Register] Creating enterprise wallet');
      // await api.post('/wallets/enterprise', { userId: session.userId });

      console.log('[Register] Registration complete, navigating to dashboard');
      navigate('/');
    } catch (err: unknown) {
      setStep('form');
      console.error('[Register] Registration failed:', err);
      const msg = err instanceof Error ? err.message : 'Registration failed';
      if (msg.includes('409') || msg.includes('already registered')) {
        setError('This email is already registered. Please sign in.');
      } else if (msg.includes('cancelled') || msg.includes('NotAllowedError')) {
        setError('Passkey creation was cancelled. Please try again.');
      } else {
        setError(msg);
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
      <div className="auth-card">
        <h2>Create Account</h2>
        <p className="auth-subtitle">
          A passkey will be created on your device. No passwords required.
        </p>

        <div className="role-toggle" role="group" aria-label="Account type">
          <button
            type="button"
            className={`role-toggle-btn ${role === 'enterprise' ? 'active' : ''}`}
            onClick={() => setRole('enterprise')}
            disabled={loading}
          >
            Enterprise
          </button>
          <button
            type="button"
            className={`role-toggle-btn ${role === 'worker' ? 'active' : ''}`}
            onClick={() => setRole('worker')}
            disabled={loading}
          >
            Worker
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            {role === 'worker' ? 'Email' : 'Work Email'}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === 'worker' ? 'you@email.com' : 'you@company.com'}
              required
              autoComplete="email"
              disabled={loading}
            />
          </label>

          {step !== 'form' && <p className="auth-status">{stepMessages[step]}</p>}
          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading || !email}>
            {loading ? stepMessages[step] || 'Working…' : 'Create Account with Passkey'}
          </button>
        </form>

        <p className="auth-link">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
