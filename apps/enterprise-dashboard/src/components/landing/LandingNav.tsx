import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineBars3, HiOutlineXMark } from 'react-icons/hi2';
import { CtaLink, MARKETING_ONLY } from './CtaLink.js';

const logoImg = '/images/logo.png';

interface LandingNavProps {
  userType: 'enterprise' | 'worker';
  onToggleUserType: () => void;
  onTalkToSales: () => void;
}

/** Top navigation — owns the mobile menu state. */
export default function LandingNav({ userType, onToggleUserType, onTalkToSales }: LandingNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="landing-nav">
      <div className="nav-container">
        <div className="logo" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} style={{ cursor: 'pointer' }}>
          <img src={logoImg} alt="Funti3rPay" className="logo-img" />
        </div>
        <button className="mobile-menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <HiOutlineXMark size={24} /> : <HiOutlineBars3 size={24} />}
        </button>
        <div className={`nav-actions ${menuOpen ? 'open' : ''}`}>
          <a href="#how" className="nav-link" onClick={() => setMenuOpen(false)}>
            How it works
          </a>
          <a href="#features" className="nav-link" onClick={() => setMenuOpen(false)}>
            Features
          </a>
          <button
            className="nav-btn nav-btn-secondary"
            onClick={() => {
              onToggleUserType();
              setMenuOpen(false);
              window.scrollTo({ top: 0 });
            }}
          >
            {userType === 'worker' ? 'For Enterprise' : 'For Workers'}
          </button>
          {MARKETING_ONLY ? (
            <button
              className="nav-btn nav-btn-secondary"
              onClick={() => {
                onTalkToSales();
                setMenuOpen(false);
              }}
            >
              Talk to Sales
            </button>
          ) : (
            <Link
              to="/login"
              className="nav-btn nav-btn-secondary"
              onClick={() => setMenuOpen(false)}
            >
              Sign In
            </Link>
          )}
          <CtaLink
            to="/register"
            className="nav-btn nav-btn-primary"
            onClick={() => setMenuOpen(false)}
          >
            Get Started
          </CtaLink>
        </div>
      </div>
    </nav>
  );
}
