import { useState } from 'react';
import { HiOutlineShieldCheck } from 'react-icons/hi2';
import { KYCForm } from '../components/KYCForm';
import { KYCStatus } from '../components/KYCStatus';
import { FAQAccordion } from '../components/FAQAccordion';

export default function KYCPage() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <HiOutlineShieldCheck size={32} style={{ color: '#3b82f6' }} />
        <h2 style={{ margin: 0, fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Know Your Customer (KYC)</h2>
      </div>
      <p style={{ color: '#666', marginBottom: '32px' }}>
        Complete your KYC verification to unlock payments and compliance features.
      </p>

      {/* KYC Status */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginTop: 0, marginBottom: '20px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Verification Status</h3>
        <KYCStatus />
      </div>

      {/* KYC Form */}
      <div>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}>
          <h3 style={{ margin: 0, marginBottom: '20px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>
            {showForm ? 'Complete Your KYC' : 'Submit KYC Information'}
          </h3>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              style={{
                padding: '10px 20px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
              }}
            >
              Start KYC
            </button>
          )}
        </div>

        {showForm ? (
          <KYCForm
            onSubmitSuccess={() => {
              setShowForm(false);
            }}
          />
        ) : (
          <div style={{
            padding: '24px',
            backgroundColor: '#f9fafb',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center',
          }}>
            <h4 style={{ color: '#4b5563', marginTop: 0 }}>Ready to verify your identity?</h4>
            <p style={{ color: '#6b7280', marginBottom: '16px' }}>
              We need your personal, identity, tax, and bank details to complete compliance requirements.
            </p>
            <button
              onClick={() => setShowForm(true)}
              style={{
                padding: '12px 28px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '16px',
              }}
            >
              Start KYC Process
            </button>
          </div>
        )}
      </div>

      {/* Information Section */}
      <div style={{ marginTop: '40px', paddingTop: '32px', borderTop: '1px solid #e5e7eb' }}>
        <h3 style={{ marginBottom: '20px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>What We Need</h3>
        <div style={{ display: 'grid', gap: '20px' }}>
          <div style={{
            padding: '16px',
            backgroundColor: '#f0f7ff',
            borderRadius: '8px',
            borderLeft: '4px solid #3b82f6',
          }}>
            <h4 style={{ margin: '0 0 8px', color: '#1e40af', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Personal Information</h4>
            <p style={{ margin: 0, color: '#3730a3', fontSize: '14px' }}>
              Your full legal name, date of birth, and nationality for identity verification.
            </p>
          </div>

          <div style={{
            padding: '16px',
            backgroundColor: '#fef3c7',
            borderRadius: '8px',
            borderLeft: '4px solid #f59e0b',
          }}>
            <h4 style={{ margin: '0 0 8px', color: '#92400e', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Government ID</h4>
            <p style={{ margin: 0, color: '#78350f', fontSize: '14px' }}>
              Passport, National ID, or Driver's License details (number, issue & expiry dates).
            </p>
          </div>

          <div style={{
            padding: '16px',
            backgroundColor: '#dbeafe',
            borderRadius: '8px',
            borderLeft: '4px solid #06b6d4',
          }}>
            <h4 style={{ margin: '0 0 8px', color: '#0e7490', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Residential Address</h4>
            <p style={{ margin: 0, color: '#164e63', fontSize: '14px' }}>
              Your current street address, city, state/province, postal code, and country.
            </p>
          </div>

          <div style={{
            padding: '16px',
            backgroundColor: '#f0fdf4',
            borderRadius: '8px',
            borderLeft: '4px solid #22c55e',
          }}>
            <h4 style={{ margin: '0 0 8px', color: '#166534', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Tax & Bank Info</h4>
            <p style={{ margin: 0, color: '#15803d', fontSize: '14px' }}>
              Tax ID, tax residency country, and bank account details for payment processing.
            </p>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div style={{ marginTop: '40px', paddingTop: '32px', borderTop: '1px solid #e5e7eb' }}>
        <h3 style={{ marginBottom: '20px', fontFamily: "'Archivo Black', sans-serif", fontWeight: 900 }}>Frequently Asked Questions</h3>
        <FAQAccordion
          items={[
            {
              question: 'Why do you need my KYC information?',
              answer:
                'KYC (Know Your Customer) is a regulatory requirement for cross-border payments. It helps us verify your identity and comply with financial regulations.',
            },
            {
              question: 'How long does verification take?',
              answer:
                'Most verifications complete within 1-3 business days. On testnet with auto-approve enabled, it\'s instant.',
            },
            {
              question: 'Is my data encrypted?',
              answer:
                'Yes, all sensitive personal and financial data is encrypted at rest and in transit. We never store unencrypted sensitive information.',
            },
            {
              question: 'Can I update my KYC information?',
              answer:
                'Yes, you can resubmit your KYC information anytime. If rejected, please correct the information and resubmit.',
            },
            {
              question: 'What if my KYC is rejected?',
              answer:
                'The rejection reason will be displayed above. Common reasons include expired documents or mismatched information. Please correct and resubmit.',
            },
          ]}
        />
      </div>
    </div>
  );
}
