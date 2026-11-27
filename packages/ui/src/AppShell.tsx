import { ElementType, ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  HiOutlineArrowRightOnRectangle, HiOutlineBars3, HiOutlineChevronDown, HiOutlineChevronLeft, HiOutlineChevronRight,
} from 'react-icons/hi2';

export interface NavItem { to: string; icon: ElementType; label: string }

interface AppShellProps {
  /** The main navigation. */
  nav: NavItem[];
  /** Links pinned to the bottom of the sidebar (settings, support). */
  footerLinks?: NavItem[];
  /** Links in the user menu above "Sign out". */
  menuLinks?: NavItem[];
  /** A title for a page that is not in the navigation (a detail page); otherwise the matching link names it. */
  titleFor?: (path: string) => string | undefined;
  /** The top bar's search box. */
  search: ReactNode;
  /** Anything else for the top bar's right side, before the user menu (a notification bell). */
  topbarExtras?: ReactNode;
  user: { email: string; role: string } | null;
  onSignOut: () => void;
  children: ReactNode;
}

const COLLAPSED_KEY = 'sidebar-collapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; }
}

/** A link is active on its own page and on the pages beneath it (/accounts/x under /accounts); "/" only on itself. */
const isActive = (to: string, path: string) => (to === '/' ? path === '/' : path === to || path.startsWith(`${to}/`));

/**
 * The signed-in frame every Funti3rPay web app shares: a collapsible sidebar (a drawer on phones) and a top bar with
 * the page title, the search box and the user menu.
 */
export default function AppShell({
  nav, footerLinks = [], menuLinks = [], titleFor, search, topbarExtras, user, onSignOut, children,
}: AppShellProps) {
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* private mode: not remembered */ }
  }, [collapsed]);

  const all = [...nav, ...footerLinks, ...menuLinks];
  const current = all.filter((l) => isActive(l.to, location.pathname)).sort((a, b) => b.to.length - a.to.length)[0];
  const pageTitle = titleFor?.(location.pathname) ?? current?.label ?? 'Funti3rPay';

  const email = user?.email ?? '';
  const displayName = email.split('@')[0];
  const initials = displayName.slice(0, 2).toUpperCase() || 'U';

  const navLink = ({ to, icon: Icon, label }: NavItem) => (
    <Link
      key={to}
      to={to}
      className={`sidebar-link${isActive(to, location.pathname) ? ' active' : ''}`}
      onClick={() => setDrawerOpen(false)}
      title={collapsed ? label : undefined}
    >
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  );

  return (
    <div className={`app-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      {drawerOpen && <div className="sidebar-overlay" onClick={() => setDrawerOpen(false)} />}
      <aside className={`sidebar${drawerOpen ? ' open' : ''}${collapsed ? ' collapsed' : ''}`}>
        <button
          className="sidebar-collapse-toggle"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <HiOutlineChevronRight size={14} /> : <HiOutlineChevronLeft size={14} />}
        </button>
        <div className="sidebar-logo">
          <img src="/images/logo-wht.png" alt="Funti3rPay" className="sidebar-logo-full" />
          <img src="/images/icon.png" alt="Funti3rPay" className="sidebar-logo-icon" />
        </div>
        <nav className="sidebar-nav">{nav.map(navLink)}</nav>
        <div className="sidebar-footer">
          {footerLinks.map(navLink)}
          <div className="sidebar-divider" />
          <button className="sidebar-signout" onClick={onSignOut} title={collapsed ? 'Sign Out' : undefined}>
            <HiOutlineArrowRightOnRectangle size={18} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <div className="content-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="topbar-hamburger" onClick={() => setDrawerOpen((o) => !o)} aria-label="Toggle menu">
              <HiOutlineBars3 size={22} />
            </button>
            <span className="topbar-title">{pageTitle}</span>
          </div>

          <div className="topbar-center">{search}</div>

          <div className="topbar-right">
            {topbarExtras}
            <div className="user-menu">
              <button className="user-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
                <span className="user-avatar">{initials}</span>
                <div className="user-meta">
                  <span className="user-meta-name">{displayName}</span>
                  <span className="user-meta-role">{user?.role}</span>
                </div>
                <HiOutlineChevronDown size={14} style={{ color: 'var(--gray-600)', flexShrink: 0 }} />
              </button>

              {menuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} onClick={() => setMenuOpen(false)} />
                  <div className="user-dropdown">
                    <div className="dropdown-header">
                      <div className="dropdown-email">{email}</div>
                    </div>
                    {menuLinks.map(({ to, icon: Icon, label }) => (
                      <Link key={to} to={to} className="dropdown-item" onClick={() => setMenuOpen(false)}>
                        <Icon size={15} /> {label}
                      </Link>
                    ))}
                    {menuLinks.length > 0 && <div className="dropdown-divider" />}
                    <button className="dropdown-item dropdown-item-danger" onClick={onSignOut}>
                      <HiOutlineArrowRightOnRectangle size={15} /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </div>
  );
}
