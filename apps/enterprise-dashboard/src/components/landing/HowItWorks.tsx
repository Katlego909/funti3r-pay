import {
  HiOutlineShieldCheck,
  HiOutlineGlobeAlt,
  HiOutlineUsers,
  HiOutlineBolt,
  HiOutlineFingerPrint,
  HiOutlineArrowsRightLeft,
} from 'react-icons/hi2';
import type { UserType } from './types.js';

const ENTERPRISE_STEPS = [
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
];

const WORKER_STEPS = [
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
];

interface HowItWorksProps {
  userType: UserType;
  onSelectUserType: (userType: UserType) => void;
}

/** How-it-works flow — enterprise/worker tabs with per-role steps. */
export default function HowItWorks({ userType, onSelectUserType }: HowItWorksProps) {
  return (
    <section className="how-it-works" id="how">
      <div className="section-header">
        <h3>How it works</h3>
        <p>From sign-up to settled in minutes</p>
      </div>

      <div className="user-type-tabs">
        <button
          className={`tab ${userType === 'enterprise' ? 'active' : ''}`}
          onClick={() => onSelectUserType('enterprise')}
        >
          For Enterprise
        </button>
        <button
          className={`tab ${userType === 'worker' ? 'active' : ''}`}
          onClick={() => onSelectUserType('worker')}
        >
          For Workers
        </button>
      </div>

      <div className="flow">
        {(userType === 'enterprise' ? ENTERPRISE_STEPS : WORKER_STEPS).map((s, i) => (
          <div className="flow-step" key={s.t}>
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
  );
}
