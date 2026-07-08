import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../hooks/useDocumentTitle.js';
import ContactModal from '../components/ContactModal.js';
import LandingNav from '../components/landing/LandingNav.js';
import HeroSection from '../components/landing/HeroSection.js';
import CurrencyStrip from '../components/landing/CurrencyStrip.js';
import HowItWorks from '../components/landing/HowItWorks.js';
import {
  TrustStats,
  FeaturesSection,
  UseCasesSection,
  SecuritySection,
  LandingFooter,
} from '../components/landing/StaticSections.js';
import FinalCta from '../components/landing/FinalCta.js';
import FaqSection from '../components/landing/FaqSection.js';
import WaitlistSection from '../components/landing/WaitlistSection.js';
import type { UserType } from '../types.js';
import '../styles/Landing.css';

/** Router `state` this page reacts to, e.g. navigated here from another page asking to jump to the footer. */
interface LandingLocationState {
  scrollToFooter?: boolean;
}

export default function Landing() {
  useDocumentTitle('Cross-Border Payroll for Africa');
  const [userType, setUserType] = useState<UserType>('enterprise');
  const [contactIntent, setContactIntent] = useState<'demo' | 'sales' | null>(null);
  const { state } = useLocation();
  const locationState = state as LandingLocationState | null;

  useEffect(() => {
    if (locationState?.scrollToFooter) {
      document.getElementById('landing-footer')?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [locationState]);

  return (
    <div className="landing">
      <LandingNav
        userType={userType}
        onToggleUserType={() => setUserType((t) => (t === 'worker' ? 'enterprise' : 'worker'))}
        onTalkToSales={() => setContactIntent('sales')}
      />
      <HeroSection userType={userType} onTalkToSales={() => setContactIntent('sales')} />
      <CurrencyStrip />
      <HowItWorks userType={userType} onSelectUserType={setUserType} />
      <TrustStats />
      <FeaturesSection />
      <UseCasesSection />
      <SecuritySection />
      <FinalCta userType={userType} onScheduleDemo={() => setContactIntent('demo')} />
      <FaqSection />
      <WaitlistSection />
      <LandingFooter />
      <ContactModal intent={contactIntent} onClose={() => setContactIntent(null)} />
    </div>
  );
}
