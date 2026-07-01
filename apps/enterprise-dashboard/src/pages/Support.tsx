import {
  HiOutlineEnvelope,
  HiOutlineBookOpen,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineCheckCircle,
  HiOutlineChatBubbleLeftRight,
  HiOutlineSignal,
} from 'react-icons/hi2';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--gray-200)',
  borderRadius: '16px',
  padding: '28px 32px',
  display: 'flex',
  alignItems: 'flex-start',
  gap: '20px',
};

const iconWrap: React.CSSProperties = {
  width: '44px',
  height: '44px',
  borderRadius: '12px',
  background: 'var(--primary-light)',
  color: 'var(--primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const cardTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 800,
  color: 'var(--gray-900)',
  marginBottom: '4px',
  fontFamily: "'Archivo Black', sans-serif",
};

const cardDesc: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--gray-600)',
  lineHeight: 1.5,
  marginBottom: '14px',
};

const linkBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '14px',
  fontWeight: 700,
  color: 'var(--primary)',
  textDecoration: 'none',
  padding: '8px 14px',
  borderRadius: '8px',
  background: 'var(--primary-light)',
  border: '1px solid var(--primary-border)',
  transition: 'background 0.15s',
};

const FAQS = [
  {
    q: 'How do I add a new worker?',
    a: 'Go to Workers → Invite Worker. Enter their email and choose their payout currency. They\'ll receive a sign-up link.',
  },
  {
    q: 'What currencies can I pay in?',
    a: 'You send USD or USDC. Workers receive NGN, KES, GHS, ZAR, UGX, or USDC — converted at the live rate.',
  },
  {
    q: 'Why did a payment fail?',
    a: 'Common causes: insufficient XLM balance for network fees, or the worker\'s trustline not set up. Check the Payments page for the specific error.',
  },
  {
    q: 'How do I top up my XLM balance?',
    a: 'Send XLM to your account\'s Stellar address shown on your Profile page. A small reserve (~1–2 XLM) covers network fees.',
  },
];

export default function Support() {
  return (
    <div style={{ maxWidth: '760px', margin: '0 auto', padding: '40px 24px' }}>
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 900, color: 'var(--gray-900)', fontFamily: "'Archivo Black', sans-serif", letterSpacing: '-1px', marginBottom: '6px' }}>
          Support
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--gray-600)' }}>Get help, read the docs, or reach the team</p>
      </div>

      {/* Contact channels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '40px' }}>
        <div style={card}>
          <div style={iconWrap}><HiOutlineEnvelope size={20} /></div>
          <div>
            <div style={cardTitle}>Email support</div>
            <div style={cardDesc}>We reply within one business day.</div>
            <a href="mailto:support@funti3rpay.com" style={linkBtn}>
              support@funti3rpay.com <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </div>
        </div>

        <div style={card}>
          <div style={iconWrap}><HiOutlineChatBubbleLeftRight size={20} /></div>
          <div>
            <div style={cardTitle}>Schedule a call</div>
            <div style={cardDesc}>Talk to the team about enterprise needs or pricing.</div>
            <a href="mailto:sales@funti3rpay.com?subject=Schedule%20a%20call" style={linkBtn}>
              Book a call <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* Resources */}
      <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--gray-900)', fontFamily: "'Archivo Black', sans-serif", marginBottom: '16px' }}>
        Resources
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '40px' }}>
        <div style={card}>
          <div style={iconWrap}><HiOutlineBookOpen size={20} /></div>
          <div>
            <div style={cardTitle}>Documentation</div>
            <div style={cardDesc}>Guides, API reference, and integration docs.</div>
            <a href="#docs" style={linkBtn}>
              Read docs <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </div>
        </div>

        <div style={card}>
          <div style={iconWrap}><HiOutlineSignal size={20} /></div>
          <div>
            <div style={cardTitle}>Status page</div>
            <div style={cardDesc}>Live uptime and incident history for all services.</div>
            <a href="#status" style={linkBtn}>
              View status <HiOutlineArrowTopRightOnSquare size={13} />
            </a>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <h3 style={{ fontSize: '20px', fontWeight: 900, color: 'var(--gray-900)', fontFamily: "'Archivo Black', sans-serif", marginBottom: '16px' }}>
        Frequently asked
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {FAQS.map((faq, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid var(--gray-200)', borderRadius: '12px', padding: '20px 24px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <HiOutlineCheckCircle size={18} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
              <div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--gray-900)', marginBottom: '6px' }}>{faq.q}</div>
                <div style={{ fontSize: '14px', color: 'var(--gray-600)', lineHeight: 1.6 }}>{faq.a}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
