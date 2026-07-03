import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { HiOutlineFingerPrint, HiOutlineCheckCircle, HiOutlineExclamationCircle } from 'react-icons/hi2';
import { toast } from 'sonner';
import { verifyRecoveryToken, registerPasskey } from '../api/auth.js';
import { useAuthStore } from '../store/authStore.js';

type Stage = 'verifying' | 'enroll' | 'done' | 'error';

export default function RecoveryVerify() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [stage, setStage] = useState<Stage>('verifying');
  const [enrolling, setEnrolling] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setErrorMsg('No token found in this link.');
      setStage('error');
      return;
    }

    verifyRecoveryToken(token)
      .then(() => setStage('enroll'))
      .catch((err) => {
        const msg = err?.response?.data?.error ?? 'This link has expired or already been used.';
        setErrorMsg(msg);
        setStage('error');
      });
  }, [searchParams]);

  async function handleEnroll() {
    if (!user?.email) return;
    setEnrolling(true);
    try {
      await registerPasskey(user.email, user.role);
      toast.success('Passkey registered — you\'re all set on this device.');
      setStage('done');
      setTimeout(() => navigate('/'), 1500);
    } catch (err: any) {
      const msg = err?.message ?? 'Passkey registration failed';
      toast.error(msg.includes('cancelled') ? 'Passkey prompt cancelled.' : msg);
    } finally {
      setEnrolling(false);
    }
  }

  function skipToApp() {
    toast.info('You can register your passkey anytime from your profile settings.');
    navigate('/');
  }

  return (
    <div className="auth-page">
      <Helmet>
        <title>Sign in | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />

        {stage === 'verifying' && (
          <>
            <h2>Signing you in…</h2>
            <p className="auth-subtitle">Verifying your link, just a moment.</p>
          </>
        )}

        {stage === 'error' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <HiOutlineExclamationCircle size={40} style={{ color: 'var(--danger)' }} />
            </div>
            <h2>Link invalid</h2>
            <p className="auth-subtitle">{errorMsg}</p>
            <div className="auth-form" style={{ marginTop: '24px' }}>
              <a href="/recovery/start" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Request a new link
              </a>
            </div>
          </>
        )}

        {stage === 'enroll' && (
          <>
            <h2>You're signed in</h2>
            <p className="auth-subtitle">
              Register your passkey on this device so you can sign in with your fingerprint next time — no link needed.
            </p>

            <div className="auth-form">
              <button
                onClick={handleEnroll}
                className="btn-cta"
                disabled={enrolling}
              >
                {enrolling ? 'Setting up passkey…' : 'Register passkey on this device'}
              </button>

              <button
                onClick={skipToApp}
                className="auth-dev-btn"
                style={{ marginTop: '8px' }}
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {stage === 'done' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              <HiOutlineCheckCircle size={40} style={{ color: 'var(--success)' }} />
            </div>
            <h2>All set</h2>
            <p className="auth-subtitle">Your passkey is registered. Taking you to the dashboard…</p>
          </>
        )}
      </div>
    </div>
  );
}
