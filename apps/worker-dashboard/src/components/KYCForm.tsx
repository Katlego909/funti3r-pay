import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { KYCTier } from '@funti3r/shared-types';

const COUNTRY_MAP: Record<string, string> = {
  'US': 'United States', 'GB': 'United Kingdom', 'CA': 'Canada', 'AU': 'Australia', 'NZ': 'New Zealand',
  'IE': 'Ireland', 'DE': 'Germany', 'FR': 'France', 'IT': 'Italy', 'ES': 'Spain', 'NL': 'Netherlands',
  'BE': 'Belgium', 'CH': 'Switzerland', 'AT': 'Austria', 'SE': 'Sweden', 'NO': 'Norway', 'DK': 'Denmark',
  'FI': 'Finland', 'PL': 'Poland', 'CZ': 'Czech Republic', 'HU': 'Hungary', 'RO': 'Romania', 'GR': 'Greece',
  'PT': 'Portugal', 'SK': 'Slovakia', 'SI': 'Slovenia', 'HR': 'Croatia', 'BG': 'Bulgaria', 'LT': 'Lithuania',
  'LV': 'Latvia', 'EE': 'Estonia', 'MT': 'Malta', 'CY': 'Cyprus', 'LU': 'Luxembourg', 'JP': 'Japan',
  'CN': 'China', 'IN': 'India', 'BR': 'Brazil', 'MX': 'Mexico', 'ZA': 'South Africa', 'NG': 'Nigeria',
  'KE': 'Kenya', 'UG': 'Uganda', 'EG': 'Egypt', 'GH': 'Ghana', 'SG': 'Singapore', 'MY': 'Malaysia',
  'TH': 'Thailand', 'VN': 'Vietnam', 'PH': 'Philippines', 'ID': 'Indonesia', 'KR': 'South Korea',
  'HK': 'Hong Kong', 'TW': 'Taiwan', 'AR': 'Argentina', 'CL': 'Chile', 'CO': 'Colombia', 'PE': 'Peru',
  'RU': 'Russia', 'AE': 'United Arab Emirates', 'SA': 'Saudi Arabia', 'IL': 'Israel', 'TR': 'Turkey',
  'PK': 'Pakistan', 'BD': 'Bangladesh', 'LK': 'Sri Lanka', 'TZ': 'Tanzania', 'UZ': 'Uzbekistan',
  'AZ': 'Azerbaijan', 'UA': 'Ukraine', 'BY': 'Belarus', 'KZ': 'Kazakhstan', 'GE': 'Georgia', 'AM': 'Armenia',
  'CU': 'Cuba', 'DZ': 'Algeria', 'MA': 'Morocco', 'TN': 'Tunisia', 'MW': 'Malawi', 'ZM': 'Zambia',
  'ZW': 'Zimbabwe', 'BW': 'Botswana', 'NA': 'Namibia', 'LS': 'Lesotho', 'SZ': 'Eswatini', 'MZ': 'Mozambique',
  'CD': 'Democratic Republic of Congo', 'AO': 'Angola', 'CM': 'Cameroon', 'CI': 'Côte d\'Ivoire', 'SN': 'Senegal',
  'BJ': 'Benin', 'TG': 'Togo', 'BF': 'Burkina Faso', 'ML': 'Mali', 'NE': 'Niger', 'TD': 'Chad', 'GA': 'Gabon',
  'CG': 'Republic of Congo', 'ST': 'São Tomé and Príncipe', 'SC': 'Seychelles', 'MU': 'Mauritius',
  'TT': 'Trinidad and Tobago', 'JM': 'Jamaica', 'BS': 'Bahamas', 'BZ': 'Belize', 'AG': 'Antigua and Barbuda',
  'LC': 'Saint Lucia', 'VC': 'Saint Vincent and the Grenadines', 'DM': 'Dominica', 'BB': 'Barbados', 'GD': 'Grenada',
  'BN': 'Brunei', 'MM': 'Myanmar', 'KH': 'Cambodia', 'LA': 'Laos', 'PS': 'Palestine', 'JO': 'Jordan', 'LB': 'Lebanon',
  'SY': 'Syria', 'IQ': 'Iraq', 'IR': 'Iran', 'AF': 'Afghanistan', 'NP': 'Nepal', 'BT': 'Bhutan', 'MN': 'Mongolia',
  'PR': 'Puerto Rico', 'VI': 'US Virgin Islands', 'GU': 'Guam',
};

const COUNTRIES = Object.keys(COUNTRY_MAP).sort();

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

export function KYCForm({ onSubmitSuccess }: KYCFormProps) {
  const { user, accessToken } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState<KYCFormData>({
    identity: {
      fullName: '',
      legalName: '',
      dateOfBirth: '',
      nationality: 'US',
      countryOfResidence: 'US',
    },
    governmentId: {
      idType: 'passport',
      idNumber: '',
      issueDate: '',
      expiryDate: '',
      country: 'US',
    },
    address: {
      streetAddress: '',
      city: '',
      stateProvince: '',
      postalCode: '',
      country: 'US',
    },
    taxInfo: {
      taxId: '',
      taxResidencyCountry: 'US',
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

  const handleSubmit = async () => {
    if (!user?.userId || !accessToken) {
      setError('You must be logged in to submit KYC');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/compliance/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          userId: user.userId,
          ...formData,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit KYC');
      }

      setSuccess(true);
      if (onSubmitSuccess) onSubmitSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit KYC');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{
        padding: '24px',
        backgroundColor: '#f0fdf4',
        borderRadius: '12px',
        border: '1px solid #86efac',
        textAlign: 'center',
      }}>
        <h3 style={{ color: '#166534', marginTop: 0 }}>✓ KYC Submitted</h3>
        <p style={{ color: '#4b5563' }}>
          Your KYC information has been submitted and is under review.
        </p>
        <button
          onClick={() => {
            setSuccess(false);
            setCurrentStep(1);
          }}
          style={{
            padding: '8px 16px',
            backgroundColor: '#22c55e',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
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
              cursor: 'pointer',
            }}
            onClick={() => setCurrentStep(step.number)}
          >
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: currentStep >= step.number ? '#3b82f6' : '#e5e7eb',
              color: currentStep >= step.number ? 'white' : '#6b7280',
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
        <div style={{
          padding: '12px',
          backgroundColor: '#fee2e2',
          border: '1px solid #fca5a5',
          borderRadius: '6px',
          color: '#991b1b',
          marginBottom: '16px',
        }}>
          {error}
        </div>
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
              <select
                value={formData.identity.nationality}
                onChange={(e) =>
                  handleChange('identity', 'nationality', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select Nationality</option>
                {COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRY_MAP[code]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
                Country of Residence *
              </label>
              <select
                value={formData.identity.countryOfResidence}
                onChange={(e) =>
                  handleChange('identity', 'countryOfResidence', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select Country</option>
                {COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRY_MAP[code]}
                  </option>
                ))}
              </select>
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
            <select
              value={formData.governmentId.country}
              onChange={(e) =>
                handleChange('governmentId', 'country', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            >
              <option value="">Select Country</option>
              {COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
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
              <select
                value={formData.address.country}
                onChange={(e) =>
                  handleChange('address', 'country', e.target.value)
                }
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="">Select Country</option>
                {COUNTRIES.map((code) => (
                  <option key={code} value={code}>
                    {COUNTRY_MAP[code]}
                  </option>
                ))}
              </select>
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
            <select
              value={formData.taxInfo.taxResidencyCountry}
              onChange={(e) =>
                handleChange('taxInfo', 'taxResidencyCountry', e.target.value)
              }
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                boxSizing: 'border-box',
              }}
            >
              <option value="">Select Country</option>
              {COUNTRIES.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </select>
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
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="ZAR">ZAR (South Africa)</option>
              <option value="NGN">NGN (Nigeria)</option>
              <option value="KES">KES (Kenya)</option>
              <option value="UGX">UGX (Uganda)</option>
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
          onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
          disabled={currentStep === 1}
          style={{
            padding: '12px 24px',
            backgroundColor: '#e5e7eb',
            color: '#374151',
            border: 'none',
            borderRadius: '6px',
            cursor: currentStep === 1 ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            opacity: currentStep === 1 ? 0.5 : 1,
          }}
        >
          Previous
        </button>

        {currentStep < 4 ? (
          <button
            onClick={() => setCurrentStep(currentStep + 1)}
            style={{
              padding: '12px 24px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Next
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              padding: '12px 24px',
              backgroundColor: '#22c55e',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Submitting...' : 'Submit KYC'}
          </button>
        )}
      </div>
    </div>
  );
}
