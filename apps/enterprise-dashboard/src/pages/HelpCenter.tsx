import { useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import {
  HiOutlineMagnifyingGlass,
  HiOutlineEnvelope,
  HiOutlineChatBubbleLeftRight,
  HiOutlineRocketLaunch,
  HiOutlineArrowsRightLeft,
  HiOutlineShieldCheck,
  HiOutlineUsers,
} from 'react-icons/hi2';
import ContactModal from '../components/ContactModal.js';
import PublicPageNav from '../components/PublicPageNav.js';
import '../styles/Landing.css';
import '../styles/HelpCenter.css';

interface HelpItem {
  question: string;
  answer: string;
}

interface HelpCategory {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: HelpItem[];
}

const CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: <HiOutlineRocketLaunch size={18} />,
    items: [
      {
        question: 'What is Funti3rPay?',
        answer:
          'Funti3rPay is a cross-border payroll platform. Enterprises send USD or USDC and their workers receive local African currencies — Naira, Shilling, Cedi, Rand and more — settled on the Stellar network in seconds.',
      },
      {
        question: 'How do I create an account?',
        answer:
          'Registration uses passkeys (WebAuthn) — you sign up with your device’s biometrics instead of a password, and a Stellar wallet is created for you automatically. No seed phrases to manage.',
      },
      {
        question: 'How do I invite my workers?',
        answer:
          'From the dashboard, go to Workers → Invite Worker and enter their email. They receive a sign-up link, register with a passkey, complete a one-time KYC check, and choose their preferred payout currency.',
      },
      {
        question: 'Can I try it before committing?',
        answer:
          'Yes — schedule a demo from the home page and we’ll walk you through a live payout. You can also join the waitlist to be notified as new currencies and features ship.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments & currencies',
    icon: <HiOutlineArrowsRightLeft size={18} />,
    items: [
      {
        question: 'Which currencies can workers receive?',
        answer:
          'Workers can be paid in USDC or local currencies — Nigerian Naira (NGN), Kenyan Shilling (KES), Ghanaian Cedi (GHS), South African Rand (ZAR) and Ugandan Shilling (UGX), with more corridors added regularly.',
      },
      {
        question: 'How fast are payments?',
        answer:
          'Payments settle on the Stellar network in a few seconds — any time of day, every day. No bank cut-off times, no multi-day batch windows.',
      },
      {
        question: 'How does the currency conversion work?',
        answer:
          'You send a USD amount; the worker receives their chosen currency, converted at the live market rate via Stellar path payments. The exact amount and rate are shown before you send and recorded on every receipt.',
      },
      {
        question: 'How much does it cost?',
        answer:
          'Settlement runs on Stellar, where network fees are a fraction of a cent per transaction. Platform pricing is transparent and scales with volume — talk to sales for enterprise rates.',
      },
      {
        question: 'Can I pay my whole team at once?',
        answer:
          'Yes — batch payroll lets you pay your entire team in one run, with different amounts and currencies per worker.',
      },
    ],
  },
  {
    id: 'security',
    title: 'Security & compliance',
    icon: <HiOutlineShieldCheck size={18} />,
    items: [
      {
        question: 'How secure is my account?',
        answer:
          'Sign-in uses passkeys (WebAuthn) — there are no passwords to phish or leak. Account keys are encrypted at rest with AES-256-GCM, and every payout is a verifiable on-chain transaction.',
      },
      {
        question: 'Why is KYC required?',
        answer:
          'Workers complete a one-time identity check before their first payout can be released. This keeps the platform compliant with anti-money-laundering rules in the corridors we serve.',
      },
      {
        question: 'Who controls the funds?',
        answer:
          'Workers hold their own Stellar accounts — payouts land in a wallet they control, not a balance we hold on their behalf. They can hold, convert, or move funds whenever they want.',
      },
      {
        question: 'Can I verify a payment independently?',
        answer:
          'Every payout is a real transaction on the public Stellar ledger. Each receipt links to the transaction on a block explorer, so payments can be audited by anyone, any time.',
      },
    ],
  },
  {
    id: 'workers',
    title: 'For workers',
    icon: <HiOutlineUsers size={18} />,
    items: [
      {
        question: 'How do I get paid?',
        answer:
          'Your employer sends an invite link. Register with a passkey, complete KYC, choose your currency — and every payout lands directly in your own Stellar wallet, instantly.',
      },
      {
        question: 'Can I withdraw my funds?',
        answer:
          'Yes. Funds land in your own Stellar account, which you control. From there you can hold, convert, or move your balance whenever you want.',
      },
      {
        question: 'How do I change my payout currency?',
        answer:
          'Your preferred currency is set in your profile. You can change it at any time — future payouts will be converted and delivered in the new currency.',
      },
      {
        question: 'What if I lose my device?',
        answer:
          'Account recovery is available via your registered email. Start the recovery flow from the sign-in page and you can register a passkey on a new device.',
      },
    ],
  },
];

export default function HelpCenter() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [contactIntent, setContactIntent] = useState<'demo' | 'sales' | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (item) =>
          item.question.toLowerCase().includes(q) || item.answer.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.items.length > 0);
  }, [query]);

  const totalMatches = filtered.reduce((n, cat) => n + cat.items.length, 0);

  return (
    <div className="landing help-center">
      <Helmet>
        <title>Help Center | Funti3rPay</title>
        <meta
          name="description"
          content="Answers about Funti3rPay — cross-border payroll, currencies, security, and getting paid."
        />
      </Helmet>

      <PublicPageNav />

      {/* Dark hero with search */}
      <div className="help-hero">
        <h1>How can we help?</h1>
        <p>Search the knowledge base or browse by topic.</p>
        <div className="help-search">
          <HiOutlineMagnifyingGlass size={18} className="help-search-icon" />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(null);
            }}
            placeholder="Search — e.g. “currencies”, “KYC”, “fees”…"
            aria-label="Search help articles"
          />
        </div>
        {query.trim() && (
          <p className="help-search-count">
            {totalMatches === 0
              ? 'No results — try a different term or contact support below.'
              : `${totalMatches} result${totalMatches === 1 ? '' : 's'}`}
          </p>
        )}
      </div>

      {/* Categories */}
      <div className="help-body">
        {filtered.map((cat) => (
          <section key={cat.id} className="help-category">
            <div className="help-cat-head">
              <span className="help-cat-icon">{cat.icon}</span>
              <h3>{cat.title}</h3>
            </div>
            {cat.items.map((item) => {
              const key = `${cat.id}:${item.question}`;
              const isOpen = open === key;
              return (
                <div key={key} className="faq-item">
                  <button
                    className={`faq-question ${isOpen ? 'open' : ''}`}
                    onClick={() => setOpen(isOpen ? null : key)}
                  >
                    <span>{item.question}</span>
                    <span className="faq-toggle">{isOpen ? '−' : '+'}</span>
                  </button>
                  {isOpen && (
                    <div className="faq-answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}

        {/* Contact */}
        <section className="help-contact">
          <h3>Still stuck?</h3>
          <div className="help-contact-grid">
            <a href="mailto:support@funti3r.xyz" className="help-contact-card">
              <span className="help-cat-icon">
                <HiOutlineEnvelope size={18} />
              </span>
              <div>
                <div className="hcc-title">Email support</div>
                <div className="hcc-sub">support@funti3r.xyz — replies within one business day</div>
              </div>
            </a>
            <button className="help-contact-card" onClick={() => setContactIntent('sales')}>
              <span className="help-cat-icon">
                <HiOutlineChatBubbleLeftRight size={18} />
              </span>
              <div>
                <div className="hcc-title">Talk to sales</div>
                <div className="hcc-sub">Enterprise plans, pricing, and demos</div>
              </div>
            </button>
          </div>
        </section>
      </div>

      <ContactModal intent={contactIntent} onClose={() => setContactIntent(null)} />
    </div>
  );
}
