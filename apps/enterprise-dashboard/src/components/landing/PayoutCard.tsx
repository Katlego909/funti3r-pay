import { HiOutlineArrowsRightLeft } from 'react-icons/hi2';
import StellarMark from './StellarMark.js';

export interface PayoutCardProps {
  sendAmount?: string;
  rateNote?: string;
  recipientName?: string;
  receiveAmount?: string;
  receiveCurrency?: string;
  flagCc?: string;
}

/** Payout product mockup — reused in the hero and final CTA, with swappable example figures. */
export default function PayoutCard({
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
            src="/images/payout-avatar.jpg"
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
