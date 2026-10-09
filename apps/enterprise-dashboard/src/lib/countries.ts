/** Countries offered in the KYC form, keyed by ISO 3166-1 alpha-2 code. */
export const COUNTRY_MAP: Record<string, string> = {
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
  'BI': 'Burundi', 'CV': 'Cabo Verde', 'CF': 'Central African Republic', 'KM': 'Comoros', 'DJ': 'Djibouti',
  'GQ': 'Equatorial Guinea', 'ER': 'Eritrea', 'ET': 'Ethiopia', 'GM': 'Gambia', 'GN': 'Guinea',
  'GW': 'Guinea-Bissau', 'LR': 'Liberia', 'LY': 'Libya', 'MG': 'Madagascar', 'MR': 'Mauritania', 'RW': 'Rwanda',
  'SL': 'Sierra Leone', 'SO': 'Somalia', 'SS': 'South Sudan', 'SD': 'Sudan',
};

// This is an African payments product: African countries lead every country list, the rest follow.
const AFRICAN_COUNTRIES = new Set([
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ',
  'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE',
  'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
]);

const byName = (a: string, b: string) => COUNTRY_MAP[a].localeCompare(COUNTRY_MAP[b]);
const ALL_CODES = Object.keys(COUNTRY_MAP);
export const AFRICA_OPTIONS = ALL_CODES.filter((c) => AFRICAN_COUNTRIES.has(c)).sort(byName);
export const OTHER_OPTIONS = ALL_CODES.filter((c) => !AFRICAN_COUNTRIES.has(c)).sort(byName);

/** Lower-case, accent-free text so "cote" finds "Côte d'Ivoire". */
const plain = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '');

/**
 * Country codes matching what the person typed, African countries first. A name matches when it starts with the
 * text or any of its words does ("congo" finds both Congos, "south" finds South Africa and South Sudan); a code
 * matches when it equals the text ("ng"). No text returns every country.
 */
export function filterCountries(query: string): string[] {
  const q = plain(query).trim();
  const all = [...AFRICA_OPTIONS, ...OTHER_OPTIONS];
  if (!q) return all;
  return all.filter((code) => {
    const words = plain(COUNTRY_MAP[code]).split(' ');
    return plain(code) === q || words.some((w, i) => w.startsWith(q) || words.slice(i).join(' ').startsWith(q));
  });
}
