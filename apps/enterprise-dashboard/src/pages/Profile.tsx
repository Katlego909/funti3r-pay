import { useAuthStore } from '../store/authStore.js';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/auth.js';
import { HiOutlineArrowRightOnRectangle, HiOutlineCheckCircle } from 'react-icons/hi2';

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.accessToken);
  const clearSession = useAuthStore((s) => s.clearSession);
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    clearSession();
    navigate('/login');
  }

  if (!user) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center' }}>
        <p style={{ fontSize: '1.1em', color: '#999' }}>Not logged in</p>
      </div>
    );
  }

  const initials = user.email
    .split('@')[0]
    .split('.')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .substring(0, 2);

  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '40px 20px' }}>
      {/* Header Section */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '24px',
          marginBottom: '40px',
          paddingBottom: '30px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '32px',
            fontWeight: 'bold',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>

        {/* User Info */}
        <div style={{ flex: 1 }}>
          <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '600' }}>
            {user.email.split('@')[0]}
          </h1>
          <p style={{ margin: '0 0 12px 0', color: '#6b7280', fontSize: '14px' }}>
            {user.email}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HiOutlineCheckCircle size={18} style={{ color: '#10b981' }} />
            <span style={{ fontSize: '14px', color: '#10b981', fontWeight: '500' }}>
              Verified Account
            </span>
          </div>
        </div>
      </div>

      {/* Account Information Section */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#111' }}>
          Account Information
        </h2>

        <div
          style={{
            display: 'grid',
            gap: '20px',
            backgroundColor: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px',
          }}
        >
          {/* Email */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>
              Email Address
            </label>
            <p style={{ margin: 0, fontSize: '15px', color: '#111', fontWeight: '500' }}>
              {user.email}
            </p>
          </div>

          {/* Role */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>
              Account Type
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  paddingLeft: '12px',
                  paddingRight: '12px',
                  paddingTop: '4px',
                  paddingBottom: '4px',
                  backgroundColor: '#dbeafe',
                  color: '#1e40af',
                  borderRadius: '4px',
                  fontSize: '13px',
                  fontWeight: '600',
                  textTransform: 'capitalize',
                }}
              >
                {user.role}
              </span>
            </div>
          </div>

          {/* User ID */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>
              User ID
            </label>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: '#374151',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                backgroundColor: 'white',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #e5e7eb',
              }}
            >
              {user.userId}
            </p>
          </div>

          {/* Token */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>
              Access Token
            </label>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                color: '#374151',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                backgroundColor: 'white',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #e5e7eb',
              }}
            >
              {token ? `${token.substring(0, 30)}...` : 'No token'}
            </p>
          </div>
        </div>
      </div>

      {/* Security Section */}
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: '#111' }}>
          Security
        </h2>
        <div
          style={{
            backgroundColor: '#f0fdf4',
            border: '1px solid #dcfce7',
            borderRadius: '8px',
            padding: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <HiOutlineCheckCircle size={20} style={{ color: '#10b981', flexShrink: 0 }} />
          <div>
            <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: '500', color: '#047857' }}>
              Passkey Authentication Enabled
            </p>
            <p style={{ margin: 0, fontSize: '13px', color: '#059669' }}>
              Your account is secured with WebAuthn
            </p>
          </div>
        </div>
      </div>

      {/* Sign Out Button */}
      <button
        onClick={handleLogout}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          width: '100%',
          padding: '12px 16px',
          backgroundColor: '#ef4444',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '15px',
          fontWeight: '600',
          transition: 'background-color 0.2s',
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#dc2626')}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ef4444')}
      >
        <HiOutlineArrowRightOnRectangle size={18} />
        Sign Out
      </button>
    </div>
  );
}
