import { Link } from 'react-router-dom';
import { HiOutlineArrowRight } from 'react-icons/hi2';
import { MARKETING_ONLY } from './CtaLink.js';
import PayoutCard from './PayoutCard.js';

interface FinalCtaProps {
  userType: 'enterprise' | 'worker';
  onScheduleDemo: () => void;
}

/** Final CTA — on marketing-only builds the demo becomes the primary action. */
export default function FinalCta({ userType, onScheduleDemo }: FinalCtaProps) {
  return (
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
                  <button
                    className="btn-final btn-final-primary"
                    onClick={onScheduleDemo}
                  >
                    Schedule a Demo <HiOutlineArrowRight size={18} />
                  </button>
                  <a href="#waitlist" className="btn-final btn-final-secondary">
                    Join the Waitlist
                  </a>
                </>
              ) : (
                <>
                  <Link to="/register" className="btn-final btn-final-primary">
                    Get Started <HiOutlineArrowRight size={18} />
                  </Link>
                  <button
                    className="btn-final btn-final-secondary"
                    onClick={onScheduleDemo}
                  >
                    Schedule a Demo
                  </button>
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
  );
}
