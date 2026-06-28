import { Link } from 'react-router-dom';
import { HiOutlineArrowRight, HiOutlineShieldCheck, HiOutlineLightBulb, HiOutlineGlobeAlt, HiOutlineCurrencyDollar, HiOutlineRocketLaunch, HiOutlineCheckCircle, HiOutlineBars3, HiOutlineXMark, HiOutlineSparkles, HiOutlineClock, HiOutlineUserGroup, HiOutlineArrowPathRoundedSquare, HiOutlineBriefcase, HiOutlineUsers } from 'react-icons/hi2';
import { useState } from 'react';
import '../styles/Landing.css';

const logoImg = '../public/images/logo.png';

const faqs = [
  {
    question: 'How long does it take to get started?',
    answer: 'Enterprise signup typically takes 5-10 minutes. Workers can create a wallet and get verified in under 15 minutes with our streamlined KYC process.',
  },
  {
    question: 'What are your transaction fees?',
    answer: 'We offer competitive, transparent fees starting from 1.5% per transaction. Volume discounts available for enterprise clients. See our pricing page for details.',
  },
  {
    question: 'Which countries do you support?',
    answer: 'We support payments to 150+ countries across Africa, Asia, Latin America, and beyond. Coverage continues to expand monthly.',
  },
  {
    question: 'Is my money secure?',
    answer: 'Yes. We use bank-grade encryption, biometric authentication, and comply with international financial regulations. Your funds are protected.',
  },
  {
    question: 'Can workers withdraw their funds anytime?',
    answer: 'Yes. Workers can withdraw to their local bank account or mobile money wallet instantly, 24/7.',
  },
  {
    question: 'Do you support multiple currencies?',
    answer: 'Absolutely. We support USD, EUR, GBP, ZAR, KES, NGN, and 50+ other currencies with real-time exchange rates.',
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
            <a href="http://localhost:3102" className="nav-btn nav-btn-secondary" onClick={() => setMenuOpen(false)}>For Enterprise</a>
            <Link to="/login" className="nav-btn nav-btn-secondary" onClick={() => setMenuOpen(false)}>Sign In</Link>
            <Link to="/register" className="nav-btn nav-btn-primary" onClick={() => setMenuOpen(false)}>Get Started</Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <h2>Pay your global workforce instantly</h2>
          <p>Send payments to workers across borders with no middlemen, low fees, and real-time settlement.</p>
          <div className="hero-cta">
            <Link to="/register" className="btn-hero btn-hero-primary">Start for Free</Link>
            <Link to="/login" className="btn-hero btn-hero-secondary">Sign In</Link>
          </div>
          <p className="hero-note">Instant setup. Connect your wallet. Start paying workers today.</p>
        </div>
        <div className="hero-graphic">
          <div className="crypto-payment-visual">
            <div className="wallet-source">
              <div className="wallet-icon">
                <HiOutlineShieldCheck size={48} />
              </div>
              <div className="wallet-label">Secure Wallet</div>
            </div>

            <div className="transfer-visualization">
              <div className="coin-flow">
                <div className="coin coin-1">✦</div>
                <div className="coin coin-2">✦</div>
                <div className="coin coin-3">✦</div>
              </div>
              <div className="flow-arrow">→</div>
            </div>

            <div className="global-reach">
              <div className="globe-icon">
                <HiOutlineGlobeAlt size={64} />
              </div>
              <div className="globe-label">150+ Countries</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="how-it-works">
        <div className="section-header">
          <h3>How it works</h3>
          <p>Simple, fast, secure</p>
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

        {userType === 'enterprise' && (
          <div className="steps">
            <div className="step">
              <div className="step-icon">
                <HiOutlineSparkles size={32} />
              </div>
              <h4>Register your business</h4>
              <p>Quick signup and verification</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineUserGroup size={32} />
              </div>
              <h4>Add your workers</h4>
              <p>Import and manage your team</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineArrowPathRoundedSquare size={32} />
              </div>
              <h4>Send payments</h4>
              <p>Pay instantly to any country</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineCheckCircle size={32} />
              </div>
              <h4>Workers receive funds</h4>
              <p>Direct to their wallet or bank</p>
            </div>
          </div>
        )}

        {userType === 'worker' && (
          <div className="steps">
            <div className="step">
              <div className="step-icon">
                <HiOutlineSparkles size={32} />
              </div>
              <h4>Create your wallet</h4>
              <p>Secure account with biometric auth</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineCheckCircle size={32} />
              </div>
              <h4>Verify your identity</h4>
              <p>Quick KYC process</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineClock size={32} />
              </div>
              <h4>Receive payments</h4>
              <p>Instantly from your employer</p>
            </div>
            <div className="step">
              <div className="step-icon">
                <HiOutlineCurrencyDollar size={32} />
              </div>
              <h4>Withdraw anytime</h4>
              <p>To your bank or mobile money</p>
            </div>
          </div>
        )}
      </section>

      {/* Features */}
      <section className="features">
        <div className="section-header">
          <h3>Why choose us</h3>
          <p>Built for modern global teams</p>
        </div>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineLightBulb size={28} />
            </div>
            <h4>Simple pricing</h4>
            <p>No hidden fees. Transparent rates for every transaction.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineShieldCheck size={28} />
            </div>
            <h4>Bank-grade security</h4>
            <p>Your payments are protected with enterprise encryption.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineCurrencyDollar size={28} />
            </div>
            <h4>Multi-currency</h4>
            <p>Send in USD, EUR, GBP, and more. Local payouts everywhere.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineRocketLaunch size={28} />
            </div>
            <h4>Instant settlement</h4>
            <p>Workers get paid immediately. No waiting for batch processing.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineGlobeAlt size={28} />
            </div>
            <h4>Global reach</h4>
            <p>Pay workers in 150+ countries with local payment methods.</p>
          </div>

          <div className="feature-card">
            <div className="feature-icon">
              <HiOutlineCheckCircle size={28} />
            </div>
            <h4>Full compliance</h4>
            <p>Regulatory approved for cross-border workforce payments.</p>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="trust">
        <div className="trust-content">
          <h3>Trusted by companies worldwide</h3>
          <p>Serving thousands of businesses and workers across Africa, Asia, and Latin America.</p>
          <div className="trust-stats">
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineGlobeAlt size={40} />
              </div>
              <div className="stat-value">150+</div>
              <div className="stat-label">Countries Supported</div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineCurrencyDollar size={40} />
              </div>
              <div className="stat-value">$500M+</div>
              <div className="stat-label">Payments Processed</div>
            </div>
            <div className="stat">
              <div className="stat-icon">
                <HiOutlineCheckCircle size={40} />
              </div>
              <div className="stat-value">99.9%</div>
              <div className="stat-label">Uptime</div>
            </div>
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="use-cases">
        <div className="section-header">
          <h3>Built for Every Team</h3>
          <p>From startups to enterprises</p>
        </div>
        <div className="use-cases-grid">
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineRocketLaunch size={32} />
            </div>
            <h4>Remote Teams</h4>
            <p>Pay distributed developers and contractors worldwide with a single click</p>
          </div>
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineBriefcase size={32} />
            </div>
            <h4>Agencies</h4>
            <p>Manage payments to freelancers across 150+ countries instantly</p>
          </div>
          <div className="use-case-card">
            <div className="use-case-icon">
              <HiOutlineUsers size={32} />
            </div>
            <h4>Gig Economy</h4>
            <p>Pay workers in real-time as they complete tasks or projects</p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="pricing">
        <div className="section-header">
          <h3>Simple, Transparent Pricing</h3>
          <p>No hidden fees. Scale as you grow.</p>
        </div>
        <div className="pricing-grid">
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
              <li>✓ Up to 100 workers</li>
              <li>✓ Multi-currency support</li>
              <li>✓ Basic analytics</li>
              <li>✓ Email support</li>
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
              <li>✓ Unlimited workers</li>
              <li>✓ Advanced analytics</li>
              <li>✓ API access</li>
              <li>✓ Priority support</li>
            </ul>
            <button className="pricing-cta">Get Started</button>
          </div>

          <div className="pricing-card">
            <div className="pricing-header">
              <h4>Enterprise</h4>
              <p className="pricing-desc">Custom solutions</p>
            </div>
            <div className="pricing-amount">
              <span className="amount">Custom</span>
              <span className="per">volume pricing</span>
            </div>
            <ul className="pricing-features">
              <li>✓ Custom rates</li>
              <li>✓ Dedicated support</li>
              <li>✓ SLA guarantee</li>
              <li>✓ White-label options</li>
            </ul>
            <button className="pricing-cta">Contact Sales</button>
          </div>
        </div>
      </section>

      {/* Security Section */}
      <section className="security">
        <div className="section-header">
          <h3>Secure & Compliant</h3>
          <p>Bank-grade security meets blockchain innovation</p>
        </div>
        <div className="security-badges">
          <div className="security-badge">
            <div className="badge-icon">🔐</div>
            <h5>Bank-Grade Encryption</h5>
            <p>256-bit AES encryption for all data</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">✓</div>
            <h5>SOC 2 Compliant</h5>
            <p>Independent security audits passed</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">🌍</div>
            <h5>Global Compliance</h5>
            <p>Licensed in 50+ jurisdictions</p>
          </div>
          <div className="security-badge">
            <div className="badge-icon">🛡️</div>
            <h5>Biometric Auth</h5>
            <p>Multi-factor authentication standard</p>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="cta-final">
        <div className="cta-content">
          <h3>Ready to pay your team smarter?</h3>
          <p>Join hundreds of companies simplifying global payments</p>
          <div className="cta-buttons">
            <Link to="/register" className="btn-final btn-final-primary">Start Free Today</Link>
            <a href="mailto:support@funti3rpay.com" className="btn-final btn-final-secondary">Contact Sales</a>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="faq">
        <div className="section-header">
          <h3>Frequently Asked Questions</h3>
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
                <span className="faq-toggle">
                  {openFaq === index ? '−' : '+'}
                </span>
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
            <p>Global workforce payments made simple.</p>
          </div>
          <div className="footer-section">
            <h5>Legal</h5>
            <ul>
              <li><a href="#privacy">Privacy Policy</a></li>
              <li><a href="#terms">Terms of Service</a></li>
              <li><a href="#compliance">Compliance</a></li>
            </ul>
          </div>
          <div className="footer-section">
            <h5>Support</h5>
            <ul>
              <li><a href="mailto:support@funti3rpay.com">Email Support</a></li>
              <li><a href="#help">Help Center</a></li>
              <li><a href="#status">Status Page</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>&copy; 2024 Funti3rPay. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
