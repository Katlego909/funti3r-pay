import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import {
  HiOutlineChartBar,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineUsers,
  HiOutlineBanknotes,
  HiOutlineShieldCheck,
  HiOutlineClock,
  HiOutlineBars3,
  HiOutlineArrowRightOnRectangle,
  HiOutlineUser,
  HiOutlineCog6Tooth,
  HiOutlineLifebuoy,
  HiOutlineChevronDown,
  HiOutlineChevronLeft,
  HiOutlineChevronRight,
  HiOutlineBell,
  HiOutlineLockClosed,
} from 'react-icons/hi2';
import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useNotificationStore } from './store/notificationStore.js';
import Dashboard from './pages/Dashboard.js';
import Payments from './pages/Payments.js';
import Schedules from './pages/Schedules.js';
import Escrows from './pages/Escrows.js';
import Workers from './pages/Workers.js';
import Profile from './pages/Profile.js';
import Settings from './pages/Settings.js';
import Support from './pages/Support.js';
import WorkerProfile from './pages/WorkerProfile.js';
import Wallet from './pages/Wallet.js';
import KYC from './pages/KYC.js';
import PaymentHistory from './pages/PaymentHistory.js';
import Login from './pages/Login.js';
import Register from './pages/Register.js';
import Landing from './pages/Landing.js';
import Terms from './pages/Terms.js';
import Privacy from './pages/Privacy.js';
import Compliance from './pages/Compliance.js';
import HelpCenter from './pages/HelpCenter.js';
import RecoveryStart from './pages/RecoveryStart.js';
import RecoveryVerify from './pages/RecoveryVerify.js';
import { useAuthStore } from './store/authStore.js';
import { logout } from './api/auth.js';
import GlobalSearch from './components/GlobalSearch.js';
import { Toaster } from 'sonner';
import './App.css';

function hasToken(): boolean {
  const storeToken = useAuthStore.getState().accessToken;
  if (storeToken) return true;
  const sessionToken = sessionStorage.getItem('access_token');
  if (sessionToken) {
    console.warn('[Auth] Token in sessionStorage but not in store, syncing...');
    useAuthStore.getState().initializeFromStorage();
    return true;
  }
  return false;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

const ENTERPRISE_NAV = [
  { to: '/', icon: HiOutlineChartBar, label: 'Dashboard' },
  { to: '/payments', icon: HiOutlineArrowPathRoundedSquare, label: 'Payments' },
  { to: '/schedules', icon: HiOutlineClock, label: 'Schedules' },
  { to: '/escrows', icon: HiOutlineLockClosed, label: 'Escrows' },
  { to: '/workers', icon: HiOutlineUsers, label: 'Workers' },
];

const WORKER_NAV = [
  { to: '/', icon: HiOutlineChartBar, label: 'Dashboard' },
  { to: '/payments', icon: HiOutlineArrowPathRoundedSquare, label: 'Payment History' },
  { to: '/wallet', icon: HiOutlineBanknotes, label: 'Wallet' },
  { to: '/kyc', icon: HiOutlineShieldCheck, label: 'KYC' },
];

const FOOTER_LINKS = [
  { to: '/settings', icon: HiOutlineCog6Tooth, label: 'Settings' },
  { to: '/support', icon: HiOutlineLifebuoy, label: 'Support' },
];

// Combined for TopBar page-title lookup
const ENTERPRISE_LINKS = [...ENTERPRISE_NAV, ...FOOTER_LINKS];
const WORKER_LINKS = [...WORKER_NAV, ...FOOTER_LINKS];

function formatTimeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { notifications, unreadCount, loading, markRead, markAllRead } = useNotificationStore();

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 149 }} onClick={onClose} />
      <div style={{
        position: 'absolute',
        top: 'calc(100% + 8px)',
        right: 0,
        width: '360px',
        background: '#fff',
        border: '1px solid var(--gray-200)',
        borderRadius: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        zIndex: 300,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid var(--gray-100)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--gray-900)' }}>
            Notifications
            {unreadCount > 0 && (
              <span style={{ marginLeft: '6px', color: 'var(--accent)', fontWeight: 700 }}>
                ({unreadCount})
              </span>
            )}
          </span>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              style={{ fontSize: '12px', color: 'var(--gray-600)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, padding: 0 }}
            >
              Mark all read
            </button>
          )}
        </div>

        <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
          {loading && notifications.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', fontSize: '13px', color: 'var(--gray-600)' }}>
              Loading…
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <HiOutlineBell size={28} style={{ color: 'var(--gray-300)', marginBottom: '8px' }} />
              <p style={{ fontSize: '13px', color: 'var(--gray-600)', margin: 0 }}>No notifications yet</p>
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => { if (!n.read_at) markRead(n.id); }}
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--gray-100)',
                  background: n.read_at ? '#fff' : 'var(--gray-50)',
                  cursor: n.read_at ? 'default' : 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: n.read_at ? 'transparent' : 'var(--accent)',
                  flexShrink: 0,
                  marginTop: '5px',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-900)', marginBottom: '2px' }}>
                    {n.title}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-600)', lineHeight: 1.5, marginBottom: '4px' }}>
                    {n.body}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gray-300)' }}>
                    {formatTimeAgo(n.created_at)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        style={{
          position: 'relative',
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: open ? 'var(--gray-100)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--gray-700)',
          flexShrink: 0,
        }}
      >
        <HiOutlineBell size={20} />
        {unreadCount > 0 && (
          <span style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            minWidth: '16px',
            height: '16px',
            borderRadius: '8px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 3px',
            lineHeight: 1,
          }}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && <NotificationPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

function Sidebar({
  role, isOpen, onClose, collapsed, onToggleCollapse,
}: {
  role: string;
  isOpen: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const navLinks = role === 'worker' ? WORKER_NAV : ENTERPRISE_NAV;
  const location = useLocation();
  const clearSession = useAuthStore((s) => s.clearSession);

  async function handleLogout() {
    await logout();
    clearSession();
  }

  const navLink = (to: string, Icon: React.ElementType, label: string) => (
    <Link
      key={to}
      to={to}
      className={`sidebar-link${location.pathname === to ? ' active' : ''}`}
      onClick={onClose}
      title={collapsed ? label : undefined}
    >
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  );

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${isOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <button
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <HiOutlineChevronRight size={14} /> : <HiOutlineChevronLeft size={14} />}
        </button>
        <div className="sidebar-logo">
          <img src="/images/logo-wht.png" alt="Funti3rPay" className="sidebar-logo-full" />
          <img src="/images/icon.png" alt="Funti3rPay" className="sidebar-logo-icon" />
        </div>
        <nav className="sidebar-nav">
          {navLinks.map(({ to, icon: Icon, label }) => navLink(to, Icon, label))}
        </nav>
        <div className="sidebar-footer">
          {FOOTER_LINKS.map(({ to, icon: Icon, label }) => navLink(to, Icon, label))}
          <div className="sidebar-divider" />
          <button className="sidebar-signout" onClick={handleLogout} title={collapsed ? 'Sign Out' : undefined}>
            <HiOutlineArrowRightOnRectangle size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function TopBar({ role, onMenuToggle }: { role: string; onMenuToggle: () => void }) {
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const allLinks = role === 'worker' ? WORKER_LINKS : ENTERPRISE_LINKS;
  const currentLink = allLinks.find((l) => l.to === location.pathname);
  const PAGE_TITLES: Record<string, string> = { '/profile': 'Profile' };
  const pageTitle = currentLink?.label ?? PAGE_TITLES[location.pathname] ?? 'Funti3rPay';

  const email = user?.email ?? '';
  const initials = email.split('@')[0].slice(0, 2).toUpperCase() || 'U';
  const displayName = email.split('@')[0];

  async function handleLogout() {
    await logout();
    clearSession();
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="topbar-hamburger" onClick={onMenuToggle} aria-label="Toggle menu">
          <HiOutlineBars3 size={22} />
        </button>
        <span className="topbar-title">{pageTitle}</span>
      </div>

      <div className="topbar-center">
        <GlobalSearch />
      </div>

      <div className="topbar-right">
        <NotificationBell />
        <div className="user-menu">
          <button className="user-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
            <span className="user-avatar">{initials}</span>
            <div className="user-meta">
              <span className="user-meta-name">{displayName}</span>
              <span className="user-meta-role">{user?.role ?? 'enterprise'}</span>
            </div>
            <HiOutlineChevronDown size={14} style={{ color: 'var(--gray-600)', flexShrink: 0 }} />
          </button>

          {menuOpen && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 150 }}
                onClick={() => setMenuOpen(false)}
              />
              <div className="user-dropdown">
                <div className="dropdown-header">
                  <div className="dropdown-email">{email}</div>
                </div>
                <Link to="/profile" className="dropdown-item" onClick={() => setMenuOpen(false)}>
                  <HiOutlineUser size={15} /> Profile
                </Link>
                <Link to="/settings" className="dropdown-item" onClick={() => setMenuOpen(false)}>
                  <HiOutlineCog6Tooth size={15} /> Settings
                </Link>
                <div className="dropdown-divider" />
                <button className="dropdown-item dropdown-item-danger" onClick={handleLogout}>
                  <HiOutlineArrowRightOnRectangle size={15} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function AuthedApp({ role }: { role: string }) {
  const isWorker = role === 'worker';
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true');
  const fetchNotifications = useNotificationStore((s) => s.fetch);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const prevUnreadRef = useRef<number | null>(null);

  useEffect(() => {
    fetchNotifications();
    const id = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(id);
  }, [fetchNotifications]);

  useEffect(() => {
    if (prevUnreadRef.current === null) {
      prevUnreadRef.current = unreadCount;
      return;
    }
    if (unreadCount > prevUnreadRef.current) {
      const delta = unreadCount - prevUnreadRef.current;
      toast.info(`${delta} new notification${delta === 1 ? '' : 's'}`, { duration: 4000 });
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <Sidebar
        role={role}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <div className="content-area">
        <TopBar role={role} onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <main className="main">
          <Routes>
            {isWorker ? (
              <>
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/payments" element={<ProtectedRoute><PaymentHistory /></ProtectedRoute>} />
                <Route path="/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
                <Route path="/kyc" element={<ProtectedRoute><KYC /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><WorkerProfile /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
              </>
            ) : (
              <>
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
                <Route path="/schedules" element={<ProtectedRoute><Schedules /></ProtectedRoute>} />
                <Route path="/escrows" element={<ProtectedRoute><Escrows /></ProtectedRoute>} />
                <Route path="/workers" element={<ProtectedRoute><Workers /></ProtectedRoute>} />
                <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
                <Route path="/support" element={<ProtectedRoute><Support /></ProtectedRoute>} />
              </>
            )}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const token = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const initializeFromStorage = useAuthStore((s) => s.initializeFromStorage);

  useEffect(() => {
    initializeFromStorage();
    console.log('[App] Initialized, current auth:', { hasToken: !!token, hasUser: !!user });
  }, [initializeFromStorage]);

  const isAuthenticated = token || hasToken();
  const role = user?.role ?? 'enterprise';

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      <Routes>
        {/* Always-public pages */}
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/help" element={<HelpCenter />} />
        <Route path="/recovery/start" element={<RecoveryStart />} />
        <Route path="/recovery/verify" element={<RecoveryVerify />} />

        {!isAuthenticated ? (
          <>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        ) : (
          <Route path="/*" element={<AuthedApp role={role} />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
