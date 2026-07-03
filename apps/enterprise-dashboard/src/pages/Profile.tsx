import { useAuthStore } from '../store/authStore.js';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/auth.js';
import {
  HiOutlineArrowRightOnRectangle,
  HiOutlineShieldCheck,
} from 'react-icons/hi2';
import WalletInfo from '../components/WalletInfo.js';

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    clearSession();
    navigate('/login');
  }

  if (!user) return null;

  const displayName = user.email.split('@')[0];
  const initials = displayName
    .split('.')
    .map((p: string) => p[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

  return (
    <div className="dashboard" style={{ maxWidth: 720, margin: '0 auto' }}>

      {/* Header */}
      <div className="dashboard-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, var(--primary) 0%, #6d28d9 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '1.25rem', fontWeight: 800,
          }}>
            {initials}
          </div>
          <div>
            <h2 style={{ margin: 0 }}>{displayName}</h2>
            <p className="subtitle" style={{ marginTop: 2 }}>{user.email}</p>
          </div>
        </div>
        <span className={`status ${user.role === 'enterprise' ? 'completed' : 'pending'}`}
          style={{ fontSize: '0.8rem', padding: '5px 12px' }}>
          {user.role === 'enterprise' ? 'Enterprise' : 'Worker'}
        </span>
      </div>

      {/* Account details */}
      <section className="section" style={{ marginBottom: 14 }}>
        <h3>Account Information</h3>
        <table className="data-table">
          <tbody>
            <tr>
              <td style={{ color: 'var(--gray-600)', width: 160, fontWeight: 600, fontSize: 13 }}>Email</td>
              <td style={{ wordBreak: 'break-word' }}>{user.email}</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--gray-600)', fontWeight: 600, fontSize: 13 }}>Account type</td>
              <td style={{ textTransform: 'capitalize' }}>{user.role}</td>
            </tr>
            <tr style={{ cursor: 'default' }}>
              <td style={{ color: 'var(--gray-600)', fontWeight: 600, fontSize: 13 }}>User ID</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gray-700)', wordBreak: 'break-all' }}>{user.userId}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Wallet */}
      <section className="section" style={{ marginBottom: 14 }}>
        <h3>Wallet</h3>
        <WalletInfo />
      </section>

      {/* Security */}
      <section className="section" style={{ marginBottom: 14 }}>
        <h3>Security</h3>
        <div className="status-item" style={{ cursor: 'default' }}>
          <div className="status-dot completed" />
          <div>
            <div className="status-name">Passkey Authentication</div>
            <div className="status-detail">Your account is secured with WebAuthn — no password required</div>
          </div>
          <HiOutlineShieldCheck size={18} style={{ color: 'var(--success)', marginLeft: 'auto' }} />
        </div>
      </section>

      {/* Sign out */}
      <button
        onClick={handleLogout}
        className="btn-secondary"
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'center', color: 'var(--danger)', borderColor: '#fecaca' }}
      >
        <HiOutlineArrowRightOnRectangle size={17} />
        Sign Out
      </button>

    </div>
  );
}
