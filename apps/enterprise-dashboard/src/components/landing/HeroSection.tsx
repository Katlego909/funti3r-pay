import { Link } from 'react-router-dom';
import { HiOutlineArrowRight } from 'react-icons/hi2';
import { CtaLink, MARKETING_ONLY } from './CtaLink.js';
import PayoutCard from './PayoutCard.js';

interface HeroSectionProps {
  userType: 'enterprise' | 'worker';
  onTalkToSales: () => void;
}

/** Hero — headline, role-dependent CTAs, and the payout product mockup. */
export default function HeroSection({ userType, onTalkToSales }: HeroSectionProps) {
  return (
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
                <button
                  className="btn-hero btn-hero-secondary"
                  onClick={onTalkToSales}
                >
                  Talk to Sales
                </button>
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
  );
}
