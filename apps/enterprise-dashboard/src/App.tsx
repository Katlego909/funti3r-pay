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
} from 'react-icons/hi2';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.js';
import Payments from './pages/Payments.js';
import Workers from './pages/Workers.js';
import Profile from './pages/Profile.js';
import WorkerDashboard from './pages/WorkerDashboard.js';
import WorkerProfile from './pages/WorkerProfile.js';
import Wallet from './pages/Wallet.js';
import KYC from './pages/KYC.js';
import PaymentHistory from './pages/PaymentHistory.js';
import Login from './pages/Login.js';
import Register from './pages/Register.js';
import Landing from './pages/Landing.js';
import { useAuthStore } from './store/authStore.js';
import { logout } from './api/auth.js';
import './App.css';

// Fallback: check sessionStorage directly if store is out of sync
function hasToken(): boolean {
  const storeToken = useAuthStore.getState().accessToken;
  if (storeToken) return true;
  // Fallback: check sessionStorage directly
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

const ENTERPRISE_LINKS = [
  { to: '/', icon: HiOutlineChartBar, label: 'Dashboard' },
  { to: '/payments', icon: HiOutlineArrowPathRoundedSquare, label: 'Payments' },
  { to: '/workers', icon: HiOutlineUsers, label: 'Workers' },
];

const WORKER_LINKS = [
  { to: '/', icon: HiOutlineChartBar, label: 'Dashboard' },
  { to: '/payments', icon: HiOutlineArrowPathRoundedSquare, label: 'Payment History' },
  { to: '/wallet', icon: HiOutlineBanknotes, label: 'Wallet' },
  { to: '/kyc', icon: HiOutlineShieldCheck, label: 'KYC' },
];

function NavBar({ role }: { role: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const links = role === 'worker' ? WORKER_LINKS : ENTERPRISE_LINKS;

  async function handleLogout() {
    await logout();
    clearSession();
  }

  return (
    <header className="header">
      <div className="header-container">
        <div className="logo">
          <img src="/images/logo.png" alt="Funti3rPay" className="logo-image" />
        </div>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          <HiOutlineBars3 size={24} />
        </button>
        <nav className={`nav ${menuOpen ? 'open' : ''}`}>
          {links.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} className="nav-link" onClick={() => setMenuOpen(false)}>
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          ))}
          {user && (
            <>
              <Link to="/profile" className="nav-link" onClick={() => setMenuOpen(false)}>
                <HiOutlineUser size={18} />
                <span>Profile</span>
              </Link>
              <button className="nav-link" onClick={handleLogout} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <HiOutlineArrowRightOnRectangle size={18} />
                <span>Sign Out</span>
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

/** Authenticated app shell — picks nav + pages by the user's role. */
function AuthedApp({ role }: { role: string }) {
  const isWorker = role === 'worker';
  return (
    <>
      <NavBar role={role} />
      <main className="main">
        <Routes>
          {isWorker ? (
            <>
              <Route path="/" element={<ProtectedRoute><WorkerDashboard /></ProtectedRoute>} />
              <Route path="/payments" element={<ProtectedRoute><PaymentHistory /></ProtectedRoute>} />
              <Route path="/wallet" element={<ProtectedRoute><Wallet /></ProtectedRoute>} />
              <Route path="/kyc" element={<ProtectedRoute><KYC /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><WorkerProfile /></ProtectedRoute>} />
            </>
          ) : (
            <>
              <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
              <Route path="/payments" element={<ProtectedRoute><Payments /></ProtectedRoute>} />
              <Route path="/workers" element={<ProtectedRoute><Workers /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
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

  // Use both store token and fallback check
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
