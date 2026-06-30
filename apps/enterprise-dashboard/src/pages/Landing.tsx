import { Link } from 'react-router-dom';
import { useState } from 'react';
import {
  HiOutlineArrowRight,
  HiOutlineShieldCheck,
  HiOutlineGlobeAlt,
  HiOutlineCurrencyDollar,
  HiOutlineCheckCircle,
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
} from 'react-icons/hi2';
import '../styles/Landing.css';

const logoImg = '../public/images/logo.png';

/** Supported payout currencies — coin mark for USDC, real flags for fiat. */
const CURRENCIES: Array<{ code: string; cc?: string; coin?: boolean }> = [
  { code: 'USDC', coin: true },
  { code: 'NGN', cc: 'ng' },
  { code: 'KES', cc: 'ke' },
  { code: 'GHS', cc: 'gh' },
  { code: 'ZAR', cc: 'za' },
  { code: 'UGX', cc: 'ug' },
];

function Flag({ cc, size = 22 }: { cc: string; size?: number }) {
  return (
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt=""
      width={size}
      height={size}
      className="flag-icon"
      loading="lazy"
    />
  );
}

/** USDC coin mark. */
function UsdcMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: 'block', borderRadius: '50%' }}
    >
      <circle cx="16" cy="16" r="16" fill="#2775CA" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="1.4" opacity="0.6" />
      <text
        x="16"
        y="21"
        textAnchor="middle"
        fontSize="13.5"
        fontWeight="800"
        fill="#fff"
        fontFamily="DM Sans, sans-serif"
      >
        $
      </text>
    </svg>
  );
}

/** Stellar network mark (orbit). */
function StellarMark({ size = 16, light = false }: { size?: number; light?: boolean }) {
  const bg = light ? '#fff' : '#0e1014';
  const fg = light ? '#0e1014' : '#fff';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: 'block', borderRadius: '50%' }}
    >
      <circle cx="16" cy="16" r="16" fill={bg} />
      <path
        d="M7 13c5-3 11 1 17-2.5"
        stroke={fg}
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M8 21.5c6-3.5 12 1 17-2.5"
        stroke={fg}
        strokeWidth="1.7"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="23" cy="10.5" r="1.7" fill={fg} />
      <circle cx="9" cy="21.5" r="1.7" fill={fg} />
    </svg>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [userType, setUserType] = useState<'enterprise' | 'worker'>('enterprise');
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="landing">
      {/* Navigation */}
      <nav className="landing-nav">
        <div className="nav-container">
          <div className="logo">
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
                setUserType('worker');
                setMenuOpen(false);
                window.scrollTo({ top: 0 });
              }}
            >
              For Workers
            </button>
            <Link
              to="/login"
              className="nav-btn nav-btn-secondary"
              onClick={() => setMenuOpen(false)}
            >
              Sign In
            </Link>
            <Link
              to="/register"
              className="nav-btn nav-btn-primary"
              onClick={() => setMenuOpen(false)}
            >
              Get Started
            </Link>
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
                  <Link to="/register" className="btn-hero btn-hero-primary">
                    Get Started <HiOutlineArrowRight size={18} />
                  </Link>
                  <a
                    href="mailto:sales@funti3rpay.com?subject=Enterprise%20Dashboard%20Access"
                    className="btn-hero btn-hero-secondary"
                  >
                    Talk to Sales
                  </a>
                </>
              ) : (
                <>
                  <Link to="/register?role=worker" className="btn-hero btn-hero-primary">
                    Start for Free <HiOutlineArrowRight size={18} />
                  </Link>
                  <Link to="/login" className="btn-hero btn-hero-secondary">
                    Sign In
                  </Link>
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
            <div className="hero-card">
              <div className="hero-card-head">
                <span className="hc-title">Payout</span>
                <span className="hc-status">
                  <span className="hc-dot" /> Settled · 4s
                </span>
              </div>

              <div className="hc-line">
                <span className="hc-usd">$</span>
                <div>
                  <div className="hc-label">You send</div>
                  <div className="hc-amount">
                    $500.00 <small>USD</small>
                  </div>
                </div>
              </div>

              <div className="hc-convert">
                <HiOutlineArrowsRightLeft size={14} /> Converted at live rate · 1 USD = 16.42 ZAR
              </div>

              <div className="hc-line hc-row-accent">
                <span className="hc-avatar-wrap">
                  <img
                    className="hc-avatar"
                    src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=160&h=160&fit=crop&crop=faces&q=80"
                    alt=""
                    loading="lazy"
                  />
                  <img
                    className="hc-avatar-flag"
                    src="https://flagcdn.com/za.svg"
                    alt=""
                    loading="lazy"
                  />
                </span>
                <div>
                  <div className="hc-label">Thandi · receives</div>
                  <div className="hc-amount hc-amount-green">
                    R8,210.75 <small>ZAR</small>
                  </div>
                </div>
              </div>

              <div className="hc-foot">
                <StellarMark size={15} /> Settled on Stellar
                <a href="#how" className="hc-link">
                  view on explorer →
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Currency / network strip */}
      <section className="strip">
        <p className="strip-label">Pay out in</p>
        <div className="currency-strip">
          {CURRENCIES.map((c) => (
            <span key={c.code} className="currency-chip">
              {c.coin ? <UsdcMark size={20} /> : <Flag cc={c.cc!} size={20} />}
              {c.code}
            </span>
          ))}
          <span className="currency-chip currency-chip-more">+ more</span>
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
                  t: 'Register your business',
                  d: 'Sign up with a passkey — no passwords to manage.',
                  tag: 'passkey',
                  icon: <HiOutlineFingerPrint size={13} />,
                  c: '#7c3aed',
                },
                {
                  t: 'Add your team',
                  d: 'Invite workers; each picks the currency they want.',
                  tag: 'multi-currency',
                  icon: <HiOutlineGlobeAlt size={13} />,
                  c: '#0d9488',
                },
                {
                  t: 'Send in USD',
                  d: 'Pay one worker or run a batch in a single click.',
                  tag: 'USD → local',
                  icon: <HiOutlineArrowsRightLeft size={13} />,
                  c: '#2563eb',
                },
                {
                  t: 'Workers get paid',
                  d: 'Local currency lands in their wallet, on-chain.',
                  tag: '~5s settle',
                  icon: <HiOutlineBolt size={13} />,
                  c: '#ea580c',
                },
              ]
            : [
                {
                  t: 'Create your wallet',
                  d: 'Secure passkey sign-in — biometric, no passwords.',
                  tag: 'passkey',
                  icon: <HiOutlineFingerPrint size={13} />,
                  c: '#7c3aed',
                },
                {
                  t: 'Verify your identity',
                  d: 'A quick one-time KYC check unlocks payouts.',
                  tag: 'KYC',
                  icon: <HiOutlineShieldCheck size={13} />,
                  c: '#0d9488',
                },
                {
                  t: 'Choose your currency',
                  d: 'Pick your local currency or USDC — change anytime.',
                  tag: '6 currencies',
                  icon: <HiOutlineGlobeAlt size={13} />,
                  c: '#2563eb',
                },
                {
                  t: 'Get paid instantly',
                  d: 'Funds arrive in seconds and are yours to control.',
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

      {/* Pricing */}
      <section className="pricing">
        <div className="section-header">
          <h3>Simple, transparent pricing</h3>
          <p>
            {userType === 'enterprise'
              ? 'Custom pricing built around your volume.'
              : 'No hidden fees. Scale as you grow.'}
          </p>
        </div>
        <div className={`pricing-grid ${userType === 'enterprise' ? 'pricing-grid-single' : ''}`}>
          {userType === 'worker' && (
            <>
              <div className="pricing-card">
                <div className="pricing-header">
                  <h4>Starter</h4>
                  <p className="pricing-desc">Perfect for small teams</p>
                </div>
                <div className="pricing-amount">
                  <span className="amount">1.5%</span>
                  <span className="per">per transaction</span>
                </div>
                <ul className="pricing-features">
                  <li>
                    <HiOutlineCheckCircle size={16} /> Up to 100 workers
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> Multi-currency payouts
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> Dashboard analytics
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> Email support
                  </li>
                </ul>
                <button className="pricing-cta">Get Started</button>
              </div>
              <div className="pricing-card featured">
                <div className="featured-badge">Popular</div>
                <div className="pricing-header">
                  <h4>Growth</h4>
                  <p className="pricing-desc">For scaling companies</p>
                </div>
                <div className="pricing-amount">
                  <span className="amount">1.2%</span>
                  <span className="per">per transaction</span>
                </div>
                <ul className="pricing-features">
                  <li>
                    <HiOutlineCheckCircle size={16} /> Unlimited workers
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> Batch payouts
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> API access
                  </li>
                  <li>
                    <HiOutlineCheckCircle size={16} /> Priority support
                  </li>
                </ul>
                <button className="pricing-cta">Get Started</button>
              </div>
            </>
          )}
          <div className="pricing-card">
            <div className="pricing-header">
              <h4>{userType === 'enterprise' ? 'Custom Enterprise' : 'Enterprise'}</h4>
              <p className="pricing-desc">
                {userType === 'enterprise' ? 'Tailored to your business' : 'Custom solutions'}
              </p>
            </div>
            <div className="pricing-amount">
              <span className="amount">Custom</span>
              <span className="per">volume pricing</span>
            </div>
            <ul className="pricing-features">
              <li>
                <HiOutlineCheckCircle size={16} /> Custom rates
              </li>
              <li>
                <HiOutlineCheckCircle size={16} /> Dedicated support
              </li>
              <li>
                <HiOutlineCheckCircle size={16} /> SLA guarantee
              </li>
              {userType === 'enterprise' && (
                <li>
                  <HiOutlineCheckCircle size={16} /> API integration
                </li>
              )}
              {userType === 'enterprise' && (
                <li>
                  <HiOutlineCheckCircle size={16} /> White-label options
                </li>
              )}
            </ul>
            <a
              href="mailto:sales@funti3rpay.com?subject=Enterprise%20Pricing%20Inquiry"
              className="pricing-cta"
              style={{ textDecoration: 'none' }}
            >
              Contact Sales
            </a>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="cta-final">
        <div className="cta-content">
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
              <>
                <Link to="/register" className="btn-final btn-final-primary">
                  Get Started <HiOutlineArrowRight size={18} />
                </Link>
                <a
                  href="mailto:sales@funti3rpay.com?subject=Enterprise%20Demo"
                  className="btn-final btn-final-secondary"
                >
                  Schedule a Demo
                </a>
              </>
            ) : (
              <>
                <Link to="/register?role=worker" className="btn-final btn-final-primary">
                  Create Wallet Free
                </Link>
                <a href="mailto:support@funti3rpay.com" className="btn-final btn-final-secondary">
                  Need Help?
                </a>
              </>
            )}
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

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h5>Funti3rPay</h5>
            <p>Global workforce payments, settled on Stellar.</p>
            <span className="footer-powered">
              <StellarMark size={16} light /> Built on the Stellar network
            </span>
          </div>
          <div className="footer-section">
            <h5>Legal</h5>
            <ul>
              <li>
                <a href="#privacy">Privacy Policy</a>
              </li>
              <li>
                <a href="#terms">Terms of Service</a>
              </li>
              <li>
                <a href="#compliance">Compliance</a>
              </li>
            </ul>
          </div>
          <div className="footer-section">
            <h5>Support</h5>
            <ul>
              <li>
                <a href="mailto:support@funti3rpay.com">Email Support</a>
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
