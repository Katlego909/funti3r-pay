import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { logout, useAuthStore } from '@funti3r/web-core';
import {
  HiOutlineBanknotes, HiOutlineBuildingOffice2, HiOutlineClipboardDocumentList, HiOutlineCog6Tooth, HiOutlineShieldCheck,
  HiOutlineSquares2X2, HiOutlineUser, HiOutlineUsers,
} from 'react-icons/hi2';
import { AppShell } from '@funti3r/ui';
import AdminSearch from './components/AdminSearch';
import Login from './pages/Login';
import Overview from './pages/Overview';
import Search from './pages/Search';
import Accounts from './pages/Accounts';
import AccountPage from './pages/Account';
import Companies from './pages/Companies';
import CompanyPage from './pages/Company';
import Compliance from './pages/Compliance';
import Money from './pages/Money';
import Audit from './pages/Audit';
import Profile from './pages/Profile';
import Settings from './pages/Settings';

const NAV = [
  { to: '/', icon: HiOutlineSquares2X2, label: 'Overview' },
  { to: '/accounts', icon: HiOutlineUsers, label: 'Accounts' },
  { to: '/companies', icon: HiOutlineBuildingOffice2, label: 'Companies' },
  { to: '/compliance', icon: HiOutlineShieldCheck, label: 'Compliance' },
  { to: '/money', icon: HiOutlineBanknotes, label: 'Money' },
  { to: '/audit', icon: HiOutlineClipboardDocumentList, label: 'Audit log' },
];
const FOOTER_LINKS = [{ to: '/settings', icon: HiOutlineCog6Tooth, label: 'Settings' }];
const MENU_LINKS = [{ to: '/profile', icon: HiOutlineUser, label: 'Profile' }, ...FOOTER_LINKS];

/** Pages that are not in the navigation: the detail pages, and search (always one click away in the top bar). */
const titleFor = (path: string) => (
  path.startsWith('/accounts/') ? 'Account' : path.startsWith('/companies/') ? 'Company' : path === '/search' ? 'Search' : undefined
);

/** Shown to anyone who signs in here without being a platform admin, after they have been signed out. */
function NotAnAdmin({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <img src="/images/logo.png" alt="Funti3rPay" className="auth-logo" />
        <h2>This is the admin console</h2>
        <p className="auth-subtitle">
          {email} is not a platform admin, so it has been signed out here. Enterprises and workers use the Funti3rPay
          dashboard.
        </p>
        <button className="btn-cta" onClick={onBack}>Back to sign in</button>
      </div>
    </div>
  );
}

export default function App() {
  const token = useAuthStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  // Anyone signed in who is not a platform admin is signed out at once: the console has nothing for them, and every
  // /admin call would be refused anyway (the gateway and each service check the role). The refusal is remembered here
  // so it stays on screen after the session is gone.
  const [refused, setRefused] = useState<string | null>(null);
  const notAdmin = !!user && user.role !== 'admin';
  useEffect(() => {
    if (!notAdmin || !user) return;
    setRefused(user.email);
    void logout().finally(clearSession);
  }, [notAdmin, user, clearSession]);
  const refusedEmail = refused ?? (notAdmin ? user!.email : null);

  return (
    <BrowserRouter>
      <Toaster position="top-right" richColors closeButton />
      {refusedEmail ? (
        <NotAnAdmin email={refusedEmail} onBack={() => setRefused(null)} />
      ) : !token || !user ? (
        <Routes><Route path="*" element={<Login />} /></Routes>
      ) : (
        <AppShell
          nav={NAV}
          footerLinks={FOOTER_LINKS}
          menuLinks={MENU_LINKS}
          titleFor={titleFor}
          search={<AdminSearch />}
          user={user}
          onSignOut={() => { void logout().finally(clearSession); }}
        >
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/search" element={<Search />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/accounts/:id" element={<AccountPage />} />
            <Route path="/companies" element={<Companies />} />
            <Route path="/companies/:id" element={<CompanyPage />} />
            <Route path="/compliance" element={<Compliance />} />
            <Route path="/money" element={<Money />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      )}
    </BrowserRouter>
  );
}
