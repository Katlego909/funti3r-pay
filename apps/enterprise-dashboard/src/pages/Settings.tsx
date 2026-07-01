import { useState } from 'react';
import { useAuthStore } from '../store/authStore.js';
import {
  HiOutlineUser,
  HiOutlineBell,
  HiOutlineGlobeAlt,
  HiOutlineShieldCheck,
  HiOutlineCheckCircle,
} from 'react-icons/hi2';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--gray-200)',
  borderRadius: '16px',
  padding: '32px',
  marginBottom: '24px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 900,
  color: 'var(--gray-900)',
  fontFamily: "'Archivo Black', sans-serif",
  letterSpacing: '-0.3px',
  marginBottom: '6px',
};

const sectionDesc: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--gray-600)',
  marginBottom: '28px',
};

const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--gray-100)',
  margin: '20px 0',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--gray-700)',
  marginBottom: '6px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const field: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--gray-200)',
  fontSize: '14px',
  color: 'var(--gray-900)',
  background: 'var(--gray-50)',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
};

function ToggleRow({ label: rowLabel, description, defaultOn = false }: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0' }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-900)', marginBottom: '2px' }}>{rowLabel}</div>
        <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{description}</div>
      </div>
      <button
        onClick={() => setOn(!on)}
        style={{
          width: '44px',
          height: '24px',
          borderRadius: '999px',
          border: 'none',
          cursor: 'pointer',
          background: on ? 'var(--primary)' : 'var(--gray-300)',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: '3px',
          left: on ? '23px' : '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 900, color: 'var(--gray-900)', fontFamily: "'Archivo Black', sans-serif", letterSpacing: '-1px', marginBottom: '6px' }}>
          Settings
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--gray-600)' }}>Manage your account and preferences</p>
      </div>

      {/* Account */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineUser size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Account</div>
        </div>
        <p style={sectionDesc}>Your account details and organisation info</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={label}>Email</label>
            <input style={field} value={user?.email ?? ''} readOnly />
          </div>
          <div>
            <label style={label}>Role</label>
            <input style={field} value={user?.role ?? 'enterprise'} readOnly />
          </div>
        </div>

        <hr style={divider} />

        <div>
          <label style={label}>Company name</label>
          <input style={{ ...field, background: '#fff' }} placeholder="Your company name" />
        </div>
      </div>

      {/* Payment preferences */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineGlobeAlt size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Payment Preferences</div>
        </div>
        <p style={sectionDesc}>Default settings applied to new payouts</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={label}>Default rail</label>
            <select style={{ ...field, background: '#fff' }}>
              <option value="stellar">Stellar</option>
            </select>
          </div>
          <div>
            <label style={label}>Send currency</label>
            <select style={{ ...field, background: '#fff' }}>
              <option value="USD">USD</option>
              <option value="USDC">USDC</option>
            </select>
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineBell size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Notifications</div>
        </div>
        <p style={sectionDesc}>Choose which email alerts you receive</p>

        <ToggleRow label="Payment completed" description="Notify when a payout settles on-chain" defaultOn />
        <hr style={divider} />
        <ToggleRow label="Payment failed" description="Notify when a payout fails" defaultOn />
        <hr style={divider} />
        <ToggleRow label="Weekly summary" description="A digest of your payout volume every Monday" />
      </div>

      {/* Security */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineShieldCheck size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Security</div>
        </div>
        <p style={sectionDesc}>Passkey authentication is active on this account</p>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '8px 14px', borderRadius: '8px',
          background: 'rgba(5,150,105,0.08)', color: 'var(--success)',
          fontSize: '13px', fontWeight: 700,
        }}>
          <HiOutlineCheckCircle size={15} /> Passkey active
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
        {saved && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)', fontSize: '14px', fontWeight: 600 }}>
            <HiOutlineCheckCircle size={16} /> Saved
          </span>
        )}
        <button
          onClick={handleSave}
          style={{
            padding: '12px 28px', background: 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}
