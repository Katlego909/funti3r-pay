import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { api } from '../api/client.js';
import { CountrySelect } from './CountrySelect.js';

interface KYCFormData {
  identity: {
    fullName: string;
    legalName: string;
    dateOfBirth: string;
    nationality: string;
    countryOfResidence: string;
  };
  governmentId: {
    idType: 'passport' | 'national_id' | 'driver_license';
    idNumber: string;
    issueDate: string;
    expiryDate: string;
    country: string;
  };
  address: {
    streetAddress: string;
    city: string;
    stateProvince: string;
    postalCode: string;
    country: string;
  };
  taxInfo: {
    taxId: string;
    taxResidencyCountry: string;
  };
  bankAccount: {
    bankName: string;
    accountHolderName: string;
    accountNumber: string;
    iban?: string;
    swiftCode?: string;
    currency: string;
  };
}

interface KYCFormProps {
  onSubmitSuccess?: () => void;
}

/** Every field marked with * on the given step must be non-empty before advancing. */
function isStepValid(step: number, data: KYCFormData): boolean {
  switch (step) {
    case 1:
      return !!(
        data.identity.fullName.trim() &&
        data.identity.legalName.trim() &&
        data.identity.dateOfBirth &&
        data.identity.nationality &&
        data.identity.countryOfResidence
      );
    case 2:
      return !!(
        data.governmentId.idNumber.trim() &&
        data.governmentId.issueDate &&
        data.governmentId.expiryDate &&
        data.governmentId.country
      );
    case 3:
      return !!(
        data.address.streetAddress.trim() &&
        data.address.city.trim() &&
        data.address.stateProvince.trim() &&
        data.address.postalCode.trim() &&
        data.address.country
      );
    case 4:
      return !!(
        data.taxInfo.taxId.trim() &&
        data.taxInfo.taxResidencyCountry &&
        data.bankAccount.bankName.trim() &&
        data.bankAccount.accountHolderName.trim() &&
        data.bankAccount.accountNumber.trim() &&
        data.bankAccount.currency
      );
    default:
      return true;
  }
}

export function KYCForm({ onSubmitSuccess }: KYCFormProps) {
  const { user } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState<KYCFormData>({
    identity: {
      fullName: '',
      legalName: '',
      dateOfBirth: '',
      nationality: '',
      countryOfResidence: '',
    },
    governmentId: {
      idType: 'passport',
      idNumber: '',
      issueDate: '',
      expiryDate: '',
      country: '',
    },
    address: {
      streetAddress: '',
      city: '',
      stateProvince: '',
      postalCode: '',
      country: '',
    },
    taxInfo: {
      taxId: '',
      taxResidencyCountry: '',
    },
    bankAccount: {
      bankName: '',
      accountHolderName: '',
      accountNumber: '',
      iban: '',
      swiftCode: '',
      currency: 'USD',
    },
  });

  const handleChange = (
    section: keyof KYCFormData,
    field: string,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value,
      },
    }));
  };

  const stepValid = isStepValid(currentStep, formData);

  const handleSubmit = async () => {
    if (!user?.userId) {
      setError('You must be logged in to submit KYC');
      return;
    }
    if (![1, 2, 3, 4].every((s) => isStepValid(s, formData))) {
      setError('Please complete all required fields before submitting.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await api.post('/compliance/submit', {
        userId: user.userId,
        ...formData,
      });

      setSuccess(true);
      if (onSubmitSuccess) onSubmitSuccess();
    } catch (err: any) {
      setError(err?.response?.data?.error ?? 'Failed to submit KYC');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div>
        <p style={{ color: 'var(--gray-600)', fontSize: '0.9rem', marginTop: 0 }}>
          Your KYC information has been submitted. Your verification status will
          update shortly.
        </p>
        <button
          className="btn-primary"
          onClick={() => {
            setSuccess(false);
            setCurrentStep(1);
          }}
        >
          Close
        </button>
      </div>
    );
  }

  const steps = [
    { number: 1, title: 'Identity' },
    { number: 2, title: 'Government ID' },
    { number: 3, title: 'Address' },
    { number: 4, title: 'Tax & Bank' },
  ];

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      {/* Step Indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '32px',
        gap: '8px',
      }}>
        {steps.map((step) => (
          <div
            key={step.number}
            style={{
              flex: 1,
              textAlign: 'center',
              // Jumping back is always fine; jumping ahead requires the
              // current step to already be complete (same gate as Next).
              cursor: step.number <= currentStep || stepValid ? 'pointer' : 'not-allowed',
              opacity: step.number <= currentStep || stepValid ? 1 : 0.5,
            }}
            onClick={() => {
              if (step.number <= currentStep || stepValid) setCurrentStep(step.number);
            }}
          >
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: currentStep >= step.number ? 'var(--primary)' : 'var(--gray-200)',
              color: currentStep >= step.number ? 'white' : 'var(--gray-600)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 8px',
              fontWeight: 600,
            }}>
              {step.number}
            </div>
            <p style={{ fontSize: '12px', margin: 0, color: '#4b5563' }}>
              {step.title}
            </p>
          </div>
        ))}
      </div>

      {error && (
        <div className="error-banner" style={{ margin: '0 0 16px' }}>{error}</div>
      )}

      {/* Step 1: Identity */}
      {currentStep === 1 && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <h3>Personal Information</h3>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Full Name *
            </label>
            <input
              type="text"
              value={formData.identity.fullName}
              onChange={(e) =>
                handleChange('identity', 'fullName', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Legal Name (as on government ID) *
            </label>
            <input
              type="text"
              value={formData.identity.legalName}
              onChange={(e) =>
                handleChange('identity', 'legalName', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Date of Birth *
            </label>
            <input
              type="date"
              value={formData.identity.dateOfBirth}
              onChange={(e) =>
                handleChange('identity', 'dateOfBirth', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Nationality *
              </label>
              <CountrySelect
              value={formData.identity.nationality}
              onChange={(code) => handleChange('identity', 'nationality', code)}
              placeholder="Select Nationality"
            />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Country of Residence *
              </label>
              <CountrySelect
              value={formData.identity.countryOfResidence}
              onChange={(code) => handleChange('identity', 'countryOfResidence', code)}
              placeholder="Select Country"
            />
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Government ID */}
      {currentStep === 2 && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <h3>Government Identification</h3>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              ID Type *
            </label>
            <select
              value={formData.governmentId.idType}
              onChange={(e) =>
                handleChange(
                  'governmentId',
                  'idType',
                  e.target.value,
                )
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            >
              <option value="passport">Passport</option>
              <option value="national_id">National ID</option>
              <option value="driver_license">Driver's License</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              ID Number *
            </label>
            <input
              type="text"
              value={formData.governmentId.idNumber}
              onChange={(e) =>
                handleChange('governmentId', 'idNumber', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Issue Date *
              </label>
              <input
                type="date"
                value={formData.governmentId.issueDate}
                onChange={(e) =>
                  handleChange('governmentId', 'issueDate', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Expiry Date *
              </label>
              <input
                type="date"
                value={formData.governmentId.expiryDate}
                onChange={(e) =>
                  handleChange('governmentId', 'expiryDate', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Issuing Country *
            </label>
            <CountrySelect
              value={formData.governmentId.country}
              onChange={(code) => handleChange('governmentId', 'country', code)}
              placeholder="Select Country"
            />
          </div>
        </div>
      )}

      {/* Step 3: Address */}
      {currentStep === 3 && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <h3>Residential Address</h3>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Street Address *
            </label>
            <input
              type="text"
              value={formData.address.streetAddress}
              onChange={(e) =>
                handleChange('address', 'streetAddress', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                City *
              </label>
              <input
                type="text"
                value={formData.address.city}
                onChange={(e) =>
                  handleChange('address', 'city', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                State / Province *
              </label>
              <input
                type="text"
                value={formData.address.stateProvince}
                onChange={(e) =>
                  handleChange('address', 'stateProvince', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Postal Code *
              </label>
              <input
                type="text"
                value={formData.address.postalCode}
                onChange={(e) =>
                  handleChange('address', 'postalCode', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Country *
              </label>
              <CountrySelect
              value={formData.address.country}
              onChange={(code) => handleChange('address', 'country', code)}
              placeholder="Select Country"
            />
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Tax & Bank */}
      {currentStep === 4 && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <h3>Tax Information & Bank Account</h3>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Tax ID (TIN) *
            </label>
            <input
              type="text"
              value={formData.taxInfo.taxId}
              onChange={(e) =>
                handleChange('taxInfo', 'taxId', e.target.value)
              }
              placeholder="e.g., 12-3456789"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Tax Residency Country *
            </label>
            <CountrySelect
              value={formData.taxInfo.taxResidencyCountry}
              onChange={(code) => handleChange('taxInfo', 'taxResidencyCountry', code)}
              placeholder="Select Country"
            />
          </div>

          <hr style={{ margin: '16px 0' }} />

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Bank Name *
            </label>
            <input
              type="text"
              value={formData.bankAccount.bankName}
              onChange={(e) =>
                handleChange('bankAccount', 'bankName', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Account Holder Name *
            </label>
            <input
              type="text"
              value={formData.bankAccount.accountHolderName}
              onChange={(e) =>
                handleChange(
                  'bankAccount',
                  'accountHolderName',
                  e.target.value,
                )
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Account Number *
            </label>
            <input
              type="text"
              value={formData.bankAccount.accountNumber}
              onChange={(e) =>
                handleChange('bankAccount', 'accountNumber', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                IBAN
              </label>
              <input
                type="text"
                value={formData.bankAccount.iban}
                onChange={(e) =>
                  handleChange('bankAccount', 'iban', e.target.value)
                }
                placeholder="Optional"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                SWIFT Code
              </label>
              <input
                type="text"
                value={formData.bankAccount.swiftCode}
                onChange={(e) =>
                  handleChange('bankAccount', 'swiftCode', e.target.value)
                }
                placeholder="Optional"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
              Currency *
            </label>
            <select
              value={formData.bankAccount.currency}
              onChange={(e) =>
                handleChange('bankAccount', 'currency', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            >
              <option value="ZAR">ZAR (South Africa)</option>
              <option value="NGN">NGN (Nigeria)</option>
              <option value="KES">KES (Kenya)</option>
              <option value="GHS">GHS (Ghana)</option>
              <option value="UGX">UGX (Uganda)</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>
      )}

      {/* Navigation Buttons */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '12px',
        marginTop: '32px',
      }}>
        <button
          className="btn-secondary"
          onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
          disabled={currentStep === 1}
        >
          Previous
        </button>

        {currentStep < 4 ? (
          <button
            className="btn-primary"
            onClick={() => setCurrentStep(currentStep + 1)}
            disabled={!stepValid}
          >
            Next
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={loading || !stepValid}
          >
            {loading ? 'Submitting...' : 'Submit KYC'}
          </button>
        )}
      </div>
      {!stepValid && (
        <p style={{ textAlign: 'right', fontSize: '12px', color: '#dc2626', marginTop: '6px' }}>
          Please complete all required fields on this step.
        </p>
      )}
    </div>
  );
}
