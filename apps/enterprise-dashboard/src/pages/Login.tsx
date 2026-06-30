import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { loginPasskey, devLogin } from '../api/auth.js';
import { useAuthStore } from '../store/authStore.js';

export default function Login() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const session = await loginPasskey(email);
      setSession({ userId: session.userId, email: session.email, role: session.role }, session.accessToken);
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg.includes('cancelled') ? 'Passkey prompt cancelled.' : msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleDevLogin() {
    setError('');
    setLoading(true);
    try {
      // Role-agnostic: the app routes to the enterprise or worker shell based
      // on the role returned by the backend.
      await devLogin(email);
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Dev login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Sign In</h2>
        <p className="auth-subtitle">Use your passkey to sign in securely.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="enterprise@company.com"
              required
              autoComplete="email"
            />
          </label>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading || !email}>
            {loading ? 'Authenticating…' : 'Sign in with Passkey'}
          </button>

          <button
            type="button"
            className="btn-secondary"
            onClick={handleDevLogin}
            disabled={loading || !email}
            style={{ marginTop: '8px' }}
          >
            Dev sign in (no passkey)
          </button>
        </form>

        <p className="auth-link">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}
