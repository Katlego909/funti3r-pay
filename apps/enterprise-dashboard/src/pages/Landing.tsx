import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import {
  HiOutlineArrowRight,
  HiOutlineShieldCheck,
  HiOutlineGlobeAlt,
  HiOutlineCurrencyDollar,
  HiOutlineBars3,
  HiOutlineXMark,
  HiOutlineUserGroup,
  HiOutlineBriefcase,
  HiOutlineUsers,
  HiOutlineBolt,
  HiOutlineLockClosed,
  HiOutlineFingerPrint,
  HiOutlineArrowsRightLeft,
  HiOutlineCpuChip,
  HiOutlineRocketLaunch,
  HiOutlineCheckCircle,
} from 'react-icons/hi2';
import { Flag, UsdcMark, XlmMark } from '../components/CurrencyIcon.js';
import '../styles/Landing.css';

const logoImg = '/images/logo.png';
const logoWhtImg = '/images/logo-wht.png';

/** Marketing-only deploys (VITE_MARKETING_ONLY=true): auth CTAs point at the waitlist instead. */
const MARKETING_ONLY = import.meta.env.VITE_MARKETING_ONLY === 'true';

/** Renders a router Link normally, or an anchor to the waitlist section on marketing-only builds. */
function CtaLink({
  to,
  className,
  onClick,
  children,
}: {
  to: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (MARKETING_ONLY) {
    return (
      <a href="#waitlist" className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

/** Supported payout currencies — coin mark for USDC/XLM, real flags for fiat. */
const CURRENCIES: Array<{ code: string; label?: string; cc?: string; coin?: boolean; xlm?: boolean }> = [
  { code: 'NGN', label: 'Nigerian Naira',      cc: 'ng' },
  { code: 'KES', label: 'Kenyan Shilling',     cc: 'ke' },
  { code: 'GHS', label: 'Ghanaian Cedi',       cc: 'gh' },
  { code: 'ZAR', label: 'South African Rand',  cc: 'za' },
  { code: 'UGX', label: 'Ugandan Shilling',    cc: 'ug' },
  { code: 'USDC', label: 'USD Coin',           coin: true },
  { code: 'TZS', label: 'Tanzanian Shilling',  cc: 'tz' },
  { code: 'RWF', label: 'Rwandan Franc',       cc: 'rw' },
  { code: 'ETB', label: 'Ethiopian Birr',      cc: 'et' },
  { code: 'EGP', label: 'Egyptian Pound',      cc: 'eg' },
  { code: 'XOF', label: 'West African Franc',  cc: 'sn' },
  { code: 'MAD', label: 'Moroccan Dirham',     cc: 'ma' },
  { code: 'XLM', label: 'Stellar Lumens',      xlm: true },
  { code: 'MWK', label: 'Malawian Kwacha',     cc: 'mw' },
  { code: 'ZMW', label: 'Zambian Kwacha',      cc: 'zm' },
];

/** Stellar network mark — official logo. */
function StellarMark({ size = 16, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      style={{ display: 'block', fill: light ? '#ffffff' : 'currentColor' }}
    >
      <path d="M12.283 1.851A10.154 10.154 0 001.846 12.002c0 .259.01.516.03.773A1.847 1.847 0 01.872 14.56L0 15.005v2.074l2.568-1.309.832-.424.82-.417 14.71-7.496 1.653-.842L24 4.85V2.776l-3.387 1.728-2.89 1.473-13.955 7.108a8.376 8.376 0 01-.07-1.086 8.313 8.313 0 0112.366-7.247l1.654-.843.247-.126a10.154 10.154 0 00-5.682-1.932zM24 6.925L5.055 16.571l-1.653.844L0 19.15v2.072L3.378 19.5l2.89-1.473 13.97-7.117a8.474 8.474 0 01.07 1.092A8.313 8.313 0 017.93 19.248l-.101.054-1.793.914a10.154 10.154 0 0016.119-8.214c0-.26-.01-.522-.03-.78a1.848 1.848 0 011.003-1.785L24 8.992Z" />
    </svg>
  );
}

interface PayoutCardProps {
  sendAmount?: string;
  rateNote?: string;
  recipientName?: string;
  receiveAmount?: string;
  receiveCurrency?: string;
  flagCc?: string;
}

/** Payout product mockup — reused in the hero and final CTA, with swappable example figures. */
function PayoutCard({
  sendAmount = '500.00',
  rateNote = '1 USD = 16.42 ZAR',
  recipientName = 'Thandi',
  receiveAmount = 'R8,210.75',
  receiveCurrency = 'ZAR',
  flagCc = 'za',
}: PayoutCardProps) {
  return (
    <div className="hero-card">
      <div className="hero-card-head">
        <span className="hc-title">Payroll</span>
        <span className="hc-status">
          <span className="hc-dot" /> Settled ~5s
        </span>
      </div>

      <div className="hc-line">
        <span className="hc-usd">$</span>
        <div>
          <div className="hc-label">You send</div>
          <div className="hc-amount">
            ${sendAmount} <small>USD</small>
          </div>
        </div>
      </div>

      <div className="hc-convert">
        <HiOutlineArrowsRightLeft size={14} /> Converted at live rate · {rateNote}
      </div>

      <div className="hc-line hc-row-accent">
        <span className="hc-avatar-wrap">
          <img
            className="hc-avatar"
            src="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=160&h=160&fit=crop&crop=faces&q=80"
            alt=""
            loading="lazy"
          />
          <img
            className="hc-avatar-flag"
            src={`https://flagcdn.com/${flagCc}.svg`}
            alt=""
            loading="lazy"
          />
        </span>
        <div>
          <div className="hc-label">
            {recipientName} · receives <span className="hc-batch">· 1 of 12</span>
          </div>
          <div className="hc-amount hc-amount-green">
            {receiveAmount} <small>{receiveCurrency}</small>
          </div>
        </div>
      </div>

      <div className="hc-foot">
        <StellarMark size={15} /> Settled on Stellar
        <span className="hc-link">view on explorer →</span>
      </div>
    </div>
  );
}

const faqs = [
  {
    question: 'Which currencies can workers receive?',
    answer:
      'Workers can be paid in USDC or in local currencies — Nigerian Naira (NGN), Kenyan Shilling (KES), Ghanaian Cedi (GHS), South African Rand (ZAR) and Ugandan Shilling (UGX), with more added regularly. Employers simply send USD and we convert at the live exchange rate.',
  },
  {
    question: 'How fast are payments?',
    answer:
      'Payments settle on the Stellar network in a few seconds — any time of day, every day. No bank cut-off times, no multi-day batch windows.',
  },
  {
    question: 'How secure is my account?',
    answer:
      'Sign-in uses passkeys (WebAuthn) — there are no passwords to phish or leak. Account keys are encrypted at rest, and every payout is a verifiable on-chain transaction.',
  },
  {
    question: 'How does the currency conversion work?',
    answer:
      'You send a USD amount; the worker receives their chosen currency, converted at the live market rate and delivered on-chain via Stellar path payments. The exact amount and rate are shown before you send and recorded on every receipt.',
  },
  {
    question: 'Can workers withdraw their funds?',
    answer:
      'Yes. Funds land in the worker’s own Stellar account, which they control. From there they can hold, convert, or move their balance whenever they want.',
  },
  {
    question: 'How much does it cost?',
    answer:
      'Settlement runs on Stellar, where network fees are a fraction of a cent per transaction. Platform pricing is transparent and scales with volume — talk to us for enterprise rates.',
  },
];

export default function Landing() {
  useDocumentTitle('Cross-Border Payroll for Africa');
  const [menuOpen, setMenuOpen] = useState(false);
  const [userType, setUserType] = useState<'enterprise' | 'worker'>('enterprise');
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const { state } = useLocation();

  function handleWaitlistSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(waitlistEmail)) {
      setWaitlistStatus('error');
      return;
    }
    // TODO: POST to a waitlist endpoint once one exists
    setWaitlistStatus('success');
  }

  useEffect(() => {
    if ((state as any)?.scrollToFooter) {
      document.getElementById('landing-footer')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [state]);

  return (
    <div className="landing">
      {/* Navigation */}
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
                setUserType(userType === 'worker' ? 'enterprise' : 'worker');
                setMenuOpen(false);
                window.scrollTo({ top: 0 });
              }}
            >
              {userType === 'worker' ? 'For Enterprise' : 'For Workers'}
            </button>
            {MARKETING_ONLY ? (
              <a
                href="mailto:sales@funti3r.xyz?subject=Enterprise%20Demo"
                className="nav-btn nav-btn-secondary"
                onClick={() => setMenuOpen(false)}
              >
                Talk to Sales
              </a>
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

      {/* Hero */}
      <div className="hero-bg">
        <section className="hero">
          <div className="hero-content">
            {/* <span className="hero-badge"><StellarMark size={16} /> Built on the Stellar network</span> */}
            <h2>Pay your global team in local currency.</h2>
            <p>
              Send in USD or USDC — your workers receive Naira, Cedi, Shilling or Rand, converted at
              live rates and settled on-chain in seconds. No middlemen, no waiting.
            </p>
            <div className="hero-cta">
              {userType === 'enterprise' ? (
                <>
                  <CtaLink to="/register" className="btn-hero btn-hero-primary">
                    Get Started <HiOutlineArrowRight size={18} />
                  </CtaLink>
                  <a
                    href="mailto:sales@funti3r.xyz?subject=Enterprise%20Dashboard%20Access"
                    className="btn-hero btn-hero-secondary"
                  >
                    Talk to Sales
                  </a>
                </>
              ) : (
                <>
                  <CtaLink to="/register?role=worker" className="btn-hero btn-hero-primary">
                    Start for Free <HiOutlineArrowRight size={18} />
                  </CtaLink>
                  {!MARKETING_ONLY && (
                    <Link to="/login" className="btn-hero btn-hero-secondary">
                      Sign In
                    </Link>
                  )}
                </>
              )}
            </div>
            {/* <p className="hero-note">
              <HiOutlineCheckCircle size={16} /> Passkey sign-in · settles in seconds · live FX
              conversion
            </p> */}
          </div>

          {/* Product mockup */}
          <div className="hero-graphic">
            <PayoutCard />
          </div>
        </section>
      </div>

      {/* Currency carousel */}
      <section className="strip">
        <p className="strip-label">Pay out in</p>
        <div className="currency-carousel-track-wrap">
          {/* Duplicate the list so the infinite scroll is seamless */}
          {[0, 1].map((pass) => (
            <div key={pass} className="currency-carousel-track" aria-hidden={pass === 1}>
              {CURRENCIES.map((c) => (
                <span key={c.code} className="currency-chip">
                  {c.coin ? <UsdcMark size={20} /> : c.xlm ? <XlmMark size={20} /> : <Flag cc={c.cc!} size={20} />}
                  {c.code}
                  {c.label && <span className="chip-label">{c.label}</span>}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works" id="how">
        <div className="section-header">
          <h3>How it works</h3>
          <p>From sign-up to settled in minutes</p>
        </div>

        <div className="user-type-tabs">
          <button
            className={`tab ${userType === 'enterprise' ? 'active' : ''}`}
            onClick={() => setUserType('enterprise')}
          >
            For Enterprise
          </button>
          <button
            className={`tab ${userType === 'worker' ? 'active' : ''}`}
            onClick={() => setUserType('worker')}
          >
            For Workers
          </button>
        </div>

        <div className="flow">
          {(userType === 'enterprise'
            ? [
                {
                  t: 'Register with a passkey',
                  d: 'Sign up biometrically — a Stellar wallet is created for you automatically.',
                  tag: 'passkey',
                  icon: <HiOutlineFingerPrint size={13} />,
                  c: '#7c3aed',
                },
                {
                  t: 'Invite your workers',
                  d: 'Send email invites — workers register, complete KYC, and set their preferred currency.',
                  tag: 'email invite',
                  icon: <HiOutlineUsers size={13} />,
                  c: '#0d9488',
                },
                {
                  t: 'Send a payout',
                  d: 'Pay one worker or run a full batch — single click, any amount, any supported currency.',
                  tag: 'single & batch',
                  icon: <HiOutlineArrowsRightLeft size={13} />,
                  c: '#2563eb',
                },
                {
                  t: 'Settled on-chain',
                  d: 'XLM is converted via the Stellar DEX and delivered in the worker\'s local currency in seconds.',
                  tag: '~5s settle',
                  icon: <HiOutlineBolt size={13} />,
                  c: '#ea580c',
                },
              ]
            : [
                {
                  t: 'Accept your invite',
                  d: 'Your employer sends an invite link — register with a passkey and your Stellar wallet is ready.',
                  tag: 'passkey',
                  icon: <HiOutlineFingerPrint size={13} />,
                  c: '#7c3aed',
                },
                {
                  t: 'Complete KYC',
                  d: 'A one-time identity check — required before your first payout can be released.',
                  tag: 'KYC',
                  icon: <HiOutlineShieldCheck size={13} />,
                  c: '#0d9488',
                },
                {
                  t: 'Set your currency',
                  d: 'Choose how you want to be paid — Naira, Shilling, Cedi, Rand, USDC, and more.',
                  tag: 'local currency',
                  icon: <HiOutlineGlobeAlt size={13} />,
                  c: '#2563eb',
                },
                {
                  t: 'Receive payments',
                  d: 'Every payout lands directly in your Stellar wallet — on-chain, instant, yours to control.',
                  tag: 'instant',
                  icon: <HiOutlineBolt size={13} />,
                  c: '#ea580c',
                },
              ]
          ).map((s, i) => (
            <div className="flow-step" key={i}>
              <span className="flow-badge">{i + 1}</span>
              <h4>{s.t}</h4>
              <p>{s.d}</p>
              <span
                className="flow-tag"
                style={{ color: s.c, background: `${s.c}14`, borderColor: `${s.c}3d` }}
              >
                {s.icon} {s.tag}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Stats band */}
      <section className="trust">
        <div className="trust-content">
          <h3>Money movement, re-engineered</h3>
          <p>Built on open blockchain rails — fast, transparent, and borderless by default.</p>
          <div className="trust-stats">
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineBolt size={34} />
              </div>
              <div className="stat-value">~5s</div>
              <div className="stat-label">Average settlement</div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineCurrencyDollar size={34} />
              </div>
              <div className="stat-value">&lt;¢1</div>
              <div className="stat-label">Network fee per payment</div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineShieldCheck size={34} />
              </div>
              <div className="stat-value">100%</div>
              <div className="stat-label">On-chain &amp; verifiable</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features" id="features">
        <div className="section-header">
          <h3>Everything you need to pay a global team</h3>
          <p>One platform — multi-currency, instant, and secure</p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineBolt size={26} />
            </div>
            <h4>Instant on-chain settlement</h4>
            <p>
              Payments clear on the Stellar network in seconds, 24/7 — no banks, no batch cut-offs.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineGlobeAlt size={26} />
            </div>
            <h4>Local-currency payouts</h4>
            <p>
              Send USD; workers receive Naira, Cedi, Shilling, Rand or Ugandan Shilling at live FX
              rates.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineCurrencyDollar size={26} />
            </div>
            <h4>Stablecoin payments</h4>
            <p>
              Pay in USDC for stable, dollar-pegged value that holds the same across every border.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineUserGroup size={26} />
            </div>
            <h4>Batch payroll</h4>
            <p>Pay your entire team in one go — different amounts and currencies per worker.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineFingerPrint size={26} />
            </div>
            <h4>Passwordless security</h4>
            <p>
              Passkey sign-in (WebAuthn). Nothing to phish, and account keys are encrypted at rest.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineShieldCheck size={26} />
            </div>
            <h4>Verifiable &amp; transparent</h4>
            <p>
              Every payout is a real on-chain transaction you can verify on the public Stellar
              ledger.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="use-cases">
        <div className="section-header">
          <h3>Built for every kind of team</h3>
          <p>From startups to global enterprises</p>
        </div>
        <div className="use-cases-grid">
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineRocketLaunch size={30} />
            </div>
            <h4>Remote teams</h4>
            <p>Pay distributed developers and contractors worldwide — in their own currency.</p>
          </div>
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineBriefcase size={30} />
            </div>
            <h4>Agencies</h4>
            <p>Manage payouts to freelancers across regions from one dashboard.</p>
          </div>
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineUsers size={30} />
            </div>
            <h4>Gig & marketplaces</h4>
            <p>Settle to workers in real time as tasks and projects complete.</p>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="security">
        <div className="section-header">
          <h3>Secure &amp; compliant by design</h3>
          <p>Modern authentication meets open-ledger transparency</p>
        </div>
        <div className="security-badges">
          <div className="security-badge">
            <div className="badge-icon">
              <HiOutlineFingerPrint size={28} />
            </div>
            <h5>Passkey authentication</h5>
            <p>Biometric WebAuthn sign-in — no passwords.</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">
              <HiOutlineLockClosed size={28} />
            </div>
            <h5>Encrypted at rest</h5>
            <p>Account keys sealed with AES-256-GCM.</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">
              <HiOutlineCpuChip size={28} />
            </div>
            <h5>On-chain &amp; verifiable</h5>
            <p>Every payment auditable on Stellar.</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">
              <HiOutlineShieldCheck size={28} />
            </div>
            <h5>Compliance built-in</h5>
            <p>KYC verification before payouts.</p>
          </div>
        </div>
      </section>

      {/* Final CTA — on marketing-only builds the demo becomes the primary action */}
      <section className="cta-final">
        <div className="cta-final-card">
          <div className="cta-final-content">
            <h3>
              {userType === 'enterprise'
                ? 'Ready to pay your team, anywhere?'
                : 'Ready to get paid instantly?'}
            </h3>
            <p>
              {userType === 'enterprise'
                ? 'Start sending cross-border payouts in minutes.'
                : 'Create your wallet and receive payments today.'}
            </p>
            <div className="cta-buttons">
              {userType === 'enterprise' ? (
                MARKETING_ONLY ? (
                  <>
                    <a
                      href="mailto:sales@funti3r.xyz?subject=Enterprise%20Demo"
                      className="btn-final btn-final-primary"
                    >
                      Schedule a Demo <HiOutlineArrowRight size={18} />
                    </a>
                    <a href="#waitlist" className="btn-final btn-final-secondary">
                      Join the Waitlist
                    </a>
                  </>
                ) : (
                  <>
                    <Link to="/register" className="btn-final btn-final-primary">
                      Get Started <HiOutlineArrowRight size={18} />
                    </Link>
                    <a
                      href="mailto:sales@funti3r.xyz?subject=Enterprise%20Demo"
                      className="btn-final btn-final-secondary"
                    >
                      Schedule a Demo
                    </a>
                  </>
                )
              ) : MARKETING_ONLY ? (
                <>
                  <a href="#waitlist" className="btn-final btn-final-primary">
                    Join the Waitlist <HiOutlineArrowRight size={18} />
                  </a>
                  <a href="mailto:support@funti3r.xyz" className="btn-final btn-final-secondary">
                    Need Help?
                  </a>
                </>
              ) : (
                <>
                  <Link to="/register?role=worker" className="btn-final btn-final-primary">
                    Create Wallet Free
                  </Link>
                  <a href="mailto:support@funti3r.xyz" className="btn-final btn-final-secondary">
                    Need Help?
                  </a>
                </>
              )}
            </div>
          </div>
          <div className="cta-final-graphic">
            <PayoutCard
              rateNote="1 USD = 1,550.40 NGN"
              recipientName="Tunde"
              receiveAmount="₦775,200.00"
              receiveCurrency="NGN"
              flagCc="ng"
            />
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq">
        <div className="section-header">
          <h3>Frequently asked questions</h3>
          <p>Everything you need to know</p>
        </div>
        <div className="faq-container">
          {faqs.map((faq, index) => (
            <div key={index} className="faq-item">
              <button
                className={`faq-question ${openFaq === index ? 'open' : ''}`}
                onClick={() => setOpenFaq(openFaq === index ? null : index)}
              >
                <span>{faq.question}</span>
                <span className="faq-toggle">{openFaq === index ? '−' : '+'}</span>
              </button>
              {openFaq === index && (
                <div className="faq-answer">
                  <p>{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Waitlist */}
      <section className="waitlist" id="waitlist">
        <div className="waitlist-card">
          <div className="waitlist-content">
            <h3>Your currency, next.</h3>
            <p>
              More payout corridors are on the way. Leave your email and we’ll tell you the day
              your currency goes live.
            </p>

            {waitlistStatus === 'success' ? (
              <div className="waitlist-success">
                <HiOutlineCheckCircle size={20} /> You’re on the list — we’ll be in touch.
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={handleWaitlistSubmit} noValidate>
                <input
                  type="email"
                  required
                  placeholder="you@company.com"
                  value={waitlistEmail}
                  onChange={(e) => {
                    setWaitlistEmail(e.target.value);
                    if (waitlistStatus === 'error') setWaitlistStatus('idle');
                  }}
                  className={`waitlist-input ${waitlistStatus === 'error' ? 'error' : ''}`}
                  aria-label="Email address"
                />
                <button type="submit" className="waitlist-submit">
                  Notify Me
                </button>
              </form>
            )}
            {waitlistStatus === 'error' && (
              <p className="waitlist-error-text">Enter a valid email address.</p>
            )}
          </div>

          {/* Upcoming-corridors mockup — same visual language as the PayoutCard */}
          <div className="waitlist-graphic">
            <div className="waitlist-mock">
              <div className="wm-head">
                <span className="hc-title">Coming soon</span>
                <span className="hc-status">
                  <span className="hc-dot" /> Waitlist open
                </span>
              </div>
              {[
                { code: 'TZS', label: 'Tanzanian Shilling', cc: 'tz', status: 'Testing' },
                { code: 'RWF', label: 'Rwandan Franc', cc: 'rw', status: 'In progress' },
                { code: 'ETB', label: 'Ethiopian Birr', cc: 'et', status: 'Planned' },
              ].map((c) => (
                <div className="wm-row" key={c.code}>
                  <Flag cc={c.cc} size={28} />
                  <div className="wm-cur">
                    <div className="wm-code">{c.code}</div>
                    <div className="wm-label">{c.label}</div>
                  </div>
                  <span className="wm-tag">{c.status}</span>
                </div>
              ))}
              <div className="wm-foot">
                <StellarMark size={15} /> Settled on Stellar, day one
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
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
                <a href="#help">Help Center</a>
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
    </div>
  );
}
