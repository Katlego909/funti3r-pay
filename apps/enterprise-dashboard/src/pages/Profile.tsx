import { useAuthStore } from '../store/authStore.js';
import { useNavigate } from 'react-router-dom';
import { logout } from '../api/auth.js';
import { HiOutlineArrowRightOnRectangle } from 'react-icons/hi2';

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
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Not logged in</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px' }}>
      <h2>Profile</h2>

      <div
        style={{
          border: '1px solid #e0e0e0',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          backgroundColor: '#f9f9f9',
        }}
      >
        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            Email
          </label>
          <p style={{ margin: 0, color: '#666' }}>{user.email}</p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            User ID
          </label>
          <p style={{ margin: 0, color: '#666', fontSize: '0.9em', wordBreak: 'break-all' }}>
            {user.userId}
          </p>
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            Role
          </label>
          <p style={{ margin: 0, color: '#666' }}>{user.role}</p>
        </div>

        <div>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
            Access Token
          </label>
          <p
            style={{
              margin: 0,
              color: '#666',
              fontSize: '0.85em',
              wordBreak: 'break-all',
              fontFamily: 'monospace',
            }}
          >
            {token ? `${token.substring(0, 20)}...` : 'No token'}
          </p>
        </div>
      </div>

      <button
        onClick={handleLogout}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 16px',
          backgroundColor: '#ff6b6b',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '1em',
          fontWeight: '500',
        }}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#ff5252')}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ff6b6b')}
      >
        <HiOutlineArrowRightOnRectangle size={18} />
        Sign Out
      </button>
    </div>
  );
}
