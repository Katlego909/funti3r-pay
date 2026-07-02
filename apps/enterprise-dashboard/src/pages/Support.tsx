import { type ReactNode } from 'react';
import {
  HiOutlineEnvelope,
  HiOutlineBookOpen,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineChatBubbleLeftRight,
  HiOutlineSignal,
} from 'react-icons/hi2';
import { FAQAccordion } from '../components/FAQAccordion.js';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';

const FAQS = [
  {
    question: 'How do I add a new worker?',
    answer: "Go to Workers → Invite Worker. Enter their email and choose their payout currency. They'll receive a sign-up link.",
  },
  {
    question: 'What currencies can I pay in?',
    answer: 'You send USD or USDC. Workers receive NGN, KES, GHS, ZAR, UGX, or USDC — converted at the live rate.',
  },
  {
    question: 'Why did a payment fail?',
    answer: "Common causes: insufficient XLM balance for network fees, or the worker's trustline not set up. Check the Payments page for the specific error.",
  },
  {
    question: 'How do I top up my XLM balance?',
    answer: "Send XLM to your account's Stellar address shown on your Profile page. A small reserve (~1–2 XLM) covers network fees.",
  },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p style={{
      fontSize: '11px',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--gray-600)',
      marginBottom: '14px',
    }}>
      {children}
    </p>
  );
}

function Card({
  icon, title, description, href, label,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  label: string;
}) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--gray-200)',
      borderRadius: '14px',
      padding: '24px',
      display: 'flex',
      gap: '16px',
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: '38px',
        height: '38px',
        borderRadius: '10px',
        background: 'var(--gray-100)',
        color: 'var(--gray-700)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--gray-900)', marginBottom: '4px' }}>
          {title}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--gray-600)', lineHeight: 1.55, marginBottom: '14px' }}>
          {description}
        </div>
        <a
          href={href}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--gray-700)',
            textDecoration: 'none',
            borderBottom: '1px solid var(--gray-300)',
            paddingBottom: '1px',
            transition: 'color 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray-900)';
            (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--gray-600)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLAnchorElement).style.color = 'var(--gray-700)';
            (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--gray-300)';
          }}
        >
          {label} <HiOutlineArrowTopRightOnSquare size={12} />
        </a>
      </div>
    </div>
  );
}

export default function Support() {
  useDocumentTitle('Support');

  return (
    <div style={{ maxWidth: '820px', margin: '0 auto', padding: '40px 24px' }}>

      {/* Header */}
      <div style={{ marginBottom: '48px' }}>
        <h2 style={{ fontSize: '28px', color: 'var(--gray-900)', marginBottom: '8px' }}>
          Support
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--gray-600)', lineHeight: 1.6 }}>
          Get help with your account, read the docs, or reach the team.
        </p>
      </div>

      {/* Contact */}
      <section style={{ marginBottom: '48px' }}>
        <SectionLabel>Contact</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Card
            icon={<HiOutlineEnvelope size={18} />}
            title="Email support"
            description="We reply within one business day."
            href="mailto:support@funti3r.xyz"
            label="support@funti3r.xyz"
          />
          <Card
            icon={<HiOutlineChatBubbleLeftRight size={18} />}
            title="Enterprise & pricing"
            description="Talk to the team about enterprise needs or custom plans."
            href="mailto:info@funti3r.xyz?subject=Schedule%20a%20call"
            label="info@funti3r.xyz"
          />
        </div>
      </section>

      {/* Resources */}
      <section style={{ marginBottom: '48px' }}>
        <SectionLabel>Resources</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <Card
            icon={<HiOutlineBookOpen size={18} />}
            title="Documentation"
            description="Guides, API reference, and integration docs."
            href="#docs"
            label="Read docs"
          />
          <Card
            icon={<HiOutlineSignal size={18} />}
            title="Status"
            description="Live uptime and incident history for all services."
            href="#status"
            label="View status"
          />
        </div>
      </section>

      {/* FAQ */}
      <section>
        <SectionLabel>Frequently asked</SectionLabel>
        <FAQAccordion items={FAQS} />
      </section>

    </div>
  );
}
