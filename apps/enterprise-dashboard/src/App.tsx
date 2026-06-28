import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import {
  HiOutlineChartBar,
  HiOutlineArrowPathRoundedSquare,
  HiOutlineUsers,
  HiOutlineBars3,
  HiOutlineArrowRightOnRectangle,
  HiOutlineUser,
} from 'react-icons/hi2';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.js';
import Payments from './pages/Payments.js';
import Workers from './pages/Workers.js';
import Profile from './pages/Profile.js';
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

function NavBar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);

  async function handleLogout() {
    await logout();
    clearSession();
  }

  return (
    <header className="header">
      <div className="header-container">
        <div className="logo">
          <h1>Funti3rPay</h1>
          <p className="tagline">Cross-Border Workforce Payments</p>
        </div>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          <HiOutlineBars3 size={24} />
        </button>
        <nav className={`nav ${menuOpen ? 'open' : ''}`}>
          <Link to="/" className="nav-link" onClick={() => setMenuOpen(false)}>
            <HiOutlineChartBar size={18} />
            <span>Dashboard</span>
          </Link>
          <Link to="/payments" className="nav-link" onClick={() => setMenuOpen(false)}>
            <HiOutlineArrowPathRoundedSquare size={18} />
            <span>Payments</span>
          </Link>
          <Link to="/workers" className="nav-link" onClick={() => setMenuOpen(false)}>
            <HiOutlineUsers size={18} />
            <span>Workers</span>
          </Link>
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

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={!isAuthenticated ? <Landing /> : <>
          <NavBar />
          <main className="main">
            <Dashboard />
          </main>
        </>} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/payments" element={<>
          <NavBar />
          <main className="main">
            <ProtectedRoute><Payments /></ProtectedRoute>
          </main>
        </>} />
        <Route path="/workers" element={<>
          <NavBar />
          <main className="main">
            <ProtectedRoute><Workers /></ProtectedRoute>
          </main>
        </>} />
        <Route path="/profile" element={<>
          <NavBar />
          <main className="main">
            <ProtectedRoute><Profile /></ProtectedRoute>
          </main>
        </>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
