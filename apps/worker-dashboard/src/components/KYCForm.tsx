import { useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { KYCTier } from '@funti3r/shared-types';

const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'IT', name: 'Italy' },
  { code: 'ES', name: 'Spain' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'BE', name: 'Belgium' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'AT', name: 'Austria' },
  { code: 'SE', name: 'Sweden' },
  { code: 'NO', name: 'Norway' },
  { code: 'DK', name: 'Denmark' },
  { code: 'FI', name: 'Finland' },
  { code: 'PL', name: 'Poland' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'HU', name: 'Hungary' },
  { code: 'RO', name: 'Romania' },
  { code: 'GR', name: 'Greece' },
  { code: 'PT', name: 'Portugal' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'HR', name: 'Croatia' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LV', name: 'Latvia' },
  { code: 'EE', name: 'Estonia' },
  { code: 'MT', name: 'Malta' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'IN', name: 'India' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'EG', name: 'Egypt' },
  { code: 'GH', name: 'Ghana' },
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'TH', name: 'Thailand' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'PH', name: 'Philippines' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'KR', name: 'South Korea' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'CO', name: 'Colombia' },
  { code: 'PE', name: 'Peru' },
  { code: 'RU', name: 'Russia' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'IL', name: 'Israel' },
  { code: 'TR', name: 'Turkey' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'BY', name: 'Belarus' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'GE', name: 'Georgia' },
  { code: 'AM', name: 'Armenia' },
  { code: 'CU', name: 'Cuba' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'MA', name: 'Morocco' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'MW', name: 'Malawi' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ZW', name: 'Zimbabwe' },
  { code: 'BW', name: 'Botswana' },
  { code: 'NA', name: 'Namibia' },
  { code: 'LS', name: 'Lesotho' },
  { code: 'SZ', name: 'Eswatini' },
  { code: 'MZ', name: 'Mozambique' },
  { code: 'CD', name: 'Democratic Republic of Congo' },
  { code: 'AO', name: 'Angola' },
  { code: 'CM', name: 'Cameroon' },
  { code: 'CI', name: 'Côte d\'Ivoire' },
  { code: 'SN', name: 'Senegal' },
  { code: 'BJ', name: 'Benin' },
  { code: 'TG', name: 'Togo' },
  { code: 'BF', name: 'Burkina Faso' },
  { code: 'ML', name: 'Mali' },
  { code: 'NE', name: 'Niger' },
  { code: 'TD', name: 'Chad' },
  { code: 'GA', name: 'Gabon' },
  { code: 'CG', name: 'Republic of Congo' },
  { code: 'ST', name: 'São Tomé and Príncipe' },
  { code: 'SC', name: 'Seychelles' },
  { code: 'MU', name: 'Mauritius' },
  { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'JM', name: 'Jamaica' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'BZ', name: 'Belize' },
  { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'LC', name: 'Saint Lucia' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines' },
  { code: 'DM', name: 'Dominica' },
  { code: 'BB', name: 'Barbados' },
  { code: 'GD', name: 'Grenada' },
  { code: 'BN', name: 'Brunei' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'LA', name: 'Laos' },
  { code: 'PS', name: 'Palestine' },
  { code: 'JO', name: 'Jordan' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'SY', name: 'Syria' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IR', name: 'Iran' },
  { code: 'AF', name: 'Afghanistan' },
  { code: 'NP', name: 'Nepal' },
  { code: 'BT', name: 'Bhutan' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'VI', name: 'US Virgin Islands' },
  { code: 'GU', name: 'Guam' },
].sort((a, b) => a.name.localeCompare(b.name));

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
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
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
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
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
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
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
