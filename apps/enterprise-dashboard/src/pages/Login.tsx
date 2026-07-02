import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import { toast } from 'sonner';
import { HiOutlineFingerPrint } from 'react-icons/hi2';
import { loginPasskey, devLogin } from '../api/auth.js';
import { useAuthStore } from '../store/authStore.js';

export default function Login() {
  useDocumentTitle('Sign In');
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const session = await loginPasskey(email);
      setSession({ userId: session.userId, email: session.email, role: session.role }, session.accessToken);
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg.includes('cancelled') ? 'Passkey prompt cancelled.' : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDevLogin() {
    setLoading(true);
    try {
      await devLogin(email);
      navigate('/');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Dev login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />

        <h2>Welcome back</h2>
        <p className="auth-subtitle">Enter your email and authenticate with your passkey to continue.</p>

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
            />
          </label>

          <button type="submit" className="btn-primary" disabled={loading || !email}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <HiOutlineFingerPrint size={18} />
            {loading ? 'Authenticating…' : 'Sign in with Passkey'}
          </button>

          <div className="auth-divider">dev only</div>

          <button
            type="button"
            className="auth-dev-btn"
            onClick={handleDevLogin}
            disabled={loading || !email}
          >
            Sign in without passkey
          </button>
        </form>

        <p className="auth-link">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
