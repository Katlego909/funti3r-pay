import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { apiErrorMessage, devLogin, loginPasskey, useAuthStore } from '@funti3r/web-core';

/** Sign in with a passkey (or, in development, by email). Admin accounts are granted by a developer, never registered. */
export default function Login() {
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  async function withPasskey(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const s = await loginPasskey(email);
      setSession({ userId: s.userId, email: s.email, role: s.role, companyId: s.companyId ?? undefined }, s.accessToken);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't sign in with a passkey on this device."));
    } finally {
      setLoading(false);
    }
  }

  async function withoutPasskey() {
    setLoading(true);
    try {
      await devLogin(email);
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Dev sign-in failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />
        <h2>Admin console</h2>
        <p className="auth-subtitle">For platform admins only. Sign in with your passkey.</p>
        <form onSubmit={withPasskey} className="auth-form">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>
          <button type="submit" className="btn-cta" disabled={loading || !email}>
            {loading ? 'Authenticating…' : 'Sign in with Passkey'}
          </button>
          {import.meta.env.DEV && (
            <>
              <div className="auth-divider">dev only</div>
              <button type="button" className="auth-dev-btn" onClick={withoutPasskey} disabled={loading || !email}>
                Sign in without passkey
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
