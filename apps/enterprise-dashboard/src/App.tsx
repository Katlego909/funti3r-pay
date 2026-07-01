import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import {
  HiOutlineChartBar,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineUsers,
  HiOutlineBanknotes,
  HiOutlineShieldCheck,
  HiOutlineBars3,
  HiOutlineArrowRightOnRectangle,
  HiOutlineUser,
  HiOutlineCog6Tooth,
  HiOutlineLifebuoy,
  HiOutlineChevronDown,
} from 'react-icons/hi2';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.js';
import Payments from './pages/Payments.js';
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
import { useAuthStore } from './store/authStore.js';
import { logout } from './api/auth.js';
import GlobalSearch from './components/GlobalSearch.js';
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

function Sidebar({ role, isOpen, onClose }: { role: string; isOpen: boolean; onClose: () => void }) {
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
    >
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  );

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${isOpen ? ' open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/images/logo-wht.png" alt="Funti3rPay" />
        </div>
        <nav className="sidebar-nav">
          {navLinks.map(({ to, icon: Icon, label }) => navLink(to, Icon, label))}
        </nav>
        <div className="sidebar-footer">
          {FOOTER_LINKS.map(({ to, icon: Icon, label }) => navLink(to, Icon, label))}
          <div className="sidebar-divider" />
          <button className="sidebar-signout" onClick={handleLogout}>
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

  return (
    <div className="app-shell">
      <Sidebar role={role} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
      {!isAuthenticated ? (
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <AuthedApp role={role} />
      )}
    </BrowserRouter>
  );
}
