import { useState } from 'react';
import type { FormEvent } from 'react';
import { HiOutlineCheckCircle } from 'react-icons/hi2';
import { Flag } from '../CurrencyIcon.js';
import { submitLead } from '../../lib/leads.js';
import { isValidEmail } from '../../lib/validation.js';
import StellarMark from './StellarMark.js';

const UPCOMING_CORRIDORS = [
  { code: 'TZS', label: 'Tanzanian Shilling', cc: 'tz', status: 'Testing' },
  { code: 'RWF', label: 'Rwandan Franc', cc: 'rw', status: 'In progress' },
  { code: 'ETB', label: 'Ethiopian Birr', cc: 'et', status: 'Planned' },
];

/** Waitlist email capture + upcoming-corridors mockup. */
export default function WaitlistSection() {
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [waitlistError, setWaitlistError] = useState('');

  async function handleWaitlistSubmit(e: FormEvent) {
    e.preventDefault();
    if (waitlistStatus === 'submitting') return;
    if (!isValidEmail(waitlistEmail)) {
      setWaitlistError('Enter a valid email address.');
      setWaitlistStatus('error');
      return;
    }
    setWaitlistStatus('submitting');
    const result = await submitLead({ type: 'waitlist', email: waitlistEmail.trim() });
    if (result === 'error') {
      setWaitlistError('Something went wrong — please try again.');
      setWaitlistStatus('error');
    } else {
      // 'duplicate' means they're already on the list — that's still a success to the visitor
      setWaitlistStatus('success');
    }
  }

  return (
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
              <button
                type="submit"
                className="waitlist-submit"
                disabled={waitlistStatus === 'submitting'}
              >
                {waitlistStatus === 'submitting' ? 'Joining…' : 'Notify Me'}
              </button>
            </form>
          )}
          {waitlistStatus === 'error' && (
            <p className="waitlist-error-text">{waitlistError}</p>
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
            {UPCOMING_CORRIDORS.map((c) => (
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
  );
}
