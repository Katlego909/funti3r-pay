import { Link } from 'react-router-dom';
import {
  HiOutlineShieldCheck,
  HiOutlineGlobeAlt,
  HiOutlineCurrencyDollar,
  HiOutlineUserGroup,
  HiOutlineBriefcase,
  HiOutlineUsers,
  HiOutlineBolt,
  HiOutlineLockClosed,
  HiOutlineFingerPrint,
  HiOutlineCpuChip,
  HiOutlineRocketLaunch,
} from 'react-icons/hi2';
import StellarMark from './StellarMark.js';

const logoWhtImg = '/images/logo-wht.png';

const TRUST_STATS = [
  { icon: <HiOutlineBolt size={34} />, value: '~5s', label: 'Average settlement' },
  { icon: <HiOutlineCurrencyDollar size={34} />, value: '<¢1', label: 'Network fee per payment' },
  { icon: <HiOutlineShieldCheck size={34} />, value: '100%', label: 'On-chain & verifiable' },
];

/** Stats band — settlement speed, fees, on-chain verifiability. */
export function TrustStats() {
  return (
    <section className="trust">
      <div className="trust-content">
        <h3>Money movement, re-engineered</h3>
        <p>Built on open blockchain rails — fast, transparent, and borderless by default.</p>
        <div className="trust-stats">
          {TRUST_STATS.map((s) => (
            <div className="stat" key={s.label}>
              <div className="stat-icon">{s.icon}</div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: <HiOutlineBolt size={26} />,
    title: 'Instant on-chain settlement',
    description: 'Payments clear on the Stellar network in seconds, 24/7 — no banks, no batch cut-offs.',
  },
  {
    icon: <HiOutlineGlobeAlt size={26} />,
    title: 'Local-currency payouts',
    description: 'Send USD; workers receive Naira, Cedi, Shilling, Rand or Ugandan Shilling at live FX rates.',
  },
  {
    icon: <HiOutlineCurrencyDollar size={26} />,
    title: 'Stablecoin payments',
    description: 'Pay in USDC for stable, dollar-pegged value that holds the same across every border.',
  },
  {
    icon: <HiOutlineUserGroup size={26} />,
    title: 'Batch payroll',
    description: 'Pay your entire team in one go — different amounts and currencies per worker.',
  },
  {
    icon: <HiOutlineFingerPrint size={26} />,
    title: 'Passwordless security',
    description: 'Passkey sign-in (WebAuthn). Nothing to phish, and account keys are encrypted at rest.',
  },
  {
    icon: <HiOutlineShieldCheck size={26} />,
    title: 'Verifiable & transparent',
    description: 'Every payout is a real on-chain transaction you can verify on the public Stellar ledger.',
  },
];

/** Features grid. */
export function FeaturesSection() {
  return (
    <section className="features" id="features">
      <div className="section-header">
        <h3>Everything you need to pay a global team</h3>
        <p>One platform — multi-currency, instant, and secure</p>
      </div>
      <div className="features-grid">
        {FEATURES.map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <h4>{f.title}</h4>
            <p>{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const USE_CASES = [
  {
    img: '/images/remote-team.jpg',
    icon: <HiOutlineRocketLaunch size={24} />,
    t: 'Remote teams',
    d: 'Pay distributed developers and contractors worldwide — in their own currency.',
  },
  {
    img: '/images/agencies.jpg',
    icon: <HiOutlineBriefcase size={24} />,
    t: 'Agencies',
    d: 'Manage payouts to freelancers across regions from one dashboard.',
  },
  {
    img: '/images/marketplace.jpg',
    icon: <HiOutlineUsers size={24} />,
    t: 'Gig & marketplaces',
    d: 'Settle to workers in real time as tasks and projects complete.',
  },
];

/** Use-case photo cards. */
export function UseCasesSection() {
  return (
    <section className="use-cases">
      <div className="section-header">
        <h3>Built for every kind of team</h3>
        <p>From startups to global enterprises</p>
      </div>
      <div className="use-cases-grid">
        {USE_CASES.map((c) => (
          <div key={c.t} className="use-case-card uc-photo">
            <img className="uc-img" src={c.img} alt="" loading="lazy" />
            <div className="use-case-icon">{c.icon}</div>
            <div className="uc-body">
              <h4>{c.t}</h4>
              <p>{c.d}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const SECURITY_BADGES = [
  {
    icon: <HiOutlineFingerPrint size={28} />,
    title: 'Passkey authentication',
    description: 'Biometric WebAuthn sign-in — no passwords.',
  },
  {
    icon: <HiOutlineLockClosed size={28} />,
    title: 'Encrypted at rest',
    description: 'Account keys sealed with AES-256-GCM.',
  },
  {
    icon: <HiOutlineCpuChip size={28} />,
    title: 'On-chain & verifiable',
    description: 'Every payment auditable on Stellar.',
  },
  {
    icon: <HiOutlineShieldCheck size={28} />,
    title: 'Compliance built-in',
    description: 'KYC verification before payouts.',
  },
];

/** Security & compliance badge row. */
export function SecuritySection() {
  return (
    <section className="security">
      <div className="section-header">
        <h3>Secure &amp; compliant by design</h3>
        <p>Modern authentication meets open-ledger transparency</p>
      </div>
      <div className="security-badges">
        {SECURITY_BADGES.map((b) => (
          <div className="security-badge" key={b.title}>
            <div className="badge-icon">{b.icon}</div>
            <h5>{b.title}</h5>
            <p>{b.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Page footer — keeps id="landing-footer" as the scroll target for other pages. */
export function LandingFooter() {
  return (
    <footer className="landing-footer" id="landing-footer">
      <div className="footer-content">
        <div className="footer-section">
          <img src={logoWhtImg} alt="Funti3rPay" className="footer-logo" />
          <p>Global workforce payments, settled on Stellar.</p>
          <span className="footer-powered">
            <StellarMark size={16} light /> Built on the Stellar network
          </span>
        </div>
        <div className="footer-section">
          <h5>Legal</h5>
          <ul>
            <li>
              <Link to="/privacy">Privacy Policy</Link>
            </li>
            <li>
              <Link to="/terms">Terms of Service</Link>
            </li>
            <li>
              <Link to="/compliance">AML & Compliance</Link>
            </li>
          </ul>
        </div>
        <div className="footer-section">
          <h5>Support</h5>
          <ul>
            <li>
              <a href="mailto:support@funti3r.xyz">Email Support</a>
            </li>
            <li>
              <Link to="/help">Help Center</Link>
            </li>
            <li>
              <a href="#status">Status Page</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; 2026 Funti3rPay. All rights reserved.</p>
      </div>
    </footer>
  );
}
