import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { KYCForm } from '../components/KYCForm';
import { KYCStatus } from '../components/KYCStatus';
import { OnchainClearanceCard } from '../components/OnchainClearanceCard';
import { FAQAccordion } from '../components/FAQAccordion';
import PageHeader from '../components/PageHeader.js';

const REQUIREMENTS = [
  { title: 'Personal information', detail: 'Your full legal name, date of birth, and nationality for identity verification.' },
  { title: 'Government ID', detail: "Passport, National ID, or Driver's License details (number, issue & expiry dates)." },
  { title: 'Residential address', detail: 'Your current street address, city, state/province, postal code, and country.' },
  { title: 'Tax & bank info', detail: 'Tax ID, tax residency country, and bank account details for payment processing.' },
];

const FAQS = [
  {
    question: 'Why do you need my KYC information?',
    answer:
      'KYC (Know Your Customer) is a regulatory requirement for cross-border payments. It helps us verify your identity and comply with financial regulations.',
  },
  {
    question: 'How long does verification take?',
    answer: "Most verifications complete within 1-3 business days. On testnet with auto-approve enabled, it's instant.",
  },
  {
    question: 'Is my data encrypted?',
    answer:
      'Yes, all sensitive personal and financial data is encrypted at rest and in transit. We never store unencrypted sensitive information.',
  },
  {
    question: 'Can I update my KYC information?',
    answer: 'Yes, you can resubmit your KYC information anytime. If rejected, please correct the information and resubmit.',
  },
  {
    question: 'What if my KYC is rejected?',
    answer:
      'The rejection reason will be displayed above. Common reasons include expired documents or mismatched information. Please correct and resubmit.',
  },
];

export default function KYCPage() {
  const [showForm, setShowForm] = useState(false);
  const [hasSubmission, setHasSubmission] = useState(false);

  return (
    <div className="dashboard" style={{ maxWidth: 1240, margin: '0 auto' }}>
      <Helmet>
        <title>KYC | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <PageHeader
        title="Know Your Customer"
        subtitle="Complete your verification to unlock payments and compliance features"
      />

      <div style={{ display: 'grid', gap: '14px', marginTop: '14px' }}>
        <section className="section">
          <h3>Verification Status</h3>
          <KYCStatus onStatusChange={(s) => setHasSubmission(s !== null)} />
          <OnchainClearanceCard />
        </section>

        <section className="section">
          <h3>{showForm ? 'Complete Your KYC' : hasSubmission ? 'Update KYC Information' : 'Submit KYC Information'}</h3>
          {showForm ? (
            <KYCForm onSubmitSuccess={() => setShowForm(false)} />
          ) : (
            <>
              <p style={{ fontSize: '0.85rem', color: 'var(--gray-600)', marginTop: '-6px', marginBottom: 16 }}>
                {hasSubmission
                  ? 'Submit your details again if something has changed or your last submission was rejected.'
                  : 'We need your personal, identity, tax, and bank details to complete compliance requirements.'}
              </p>
              <button className="btn-primary" onClick={() => setShowForm(true)}>
                {hasSubmission ? 'Resubmit KYC' : 'Start KYC'}
              </button>
            </>
          )}
        </section>

        <section className="section">
          <h3>What We Need</h3>
          <div style={{ display: 'grid', gap: 0 }}>
            {REQUIREMENTS.map((r, i) => (
              <div
                key={r.title}
                style={{ padding: '12px 0', borderTop: i === 0 ? 'none' : '1px solid var(--gray-200)' }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--gray-900)' }}>{r.title}</div>
                <div style={{ fontSize: '0.84rem', color: 'var(--gray-600)', marginTop: 2 }}>{r.detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h3>Frequently Asked Questions</h3>
          <FAQAccordion items={FAQS} />
        </section>
      </div>
    </div>
  );
}
