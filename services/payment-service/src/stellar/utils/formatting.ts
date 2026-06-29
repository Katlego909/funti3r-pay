/**
 * Stellar Amount Formatting Utilities
 * Converts between stroops (internal unit) and XLM (user-facing unit)
 */

// 1 XLM = 10,000,000 stroops
const STROOPS_PER_XLM = 10_000_000;

/**
 * Format stroops to XLM
 * Converts internal stroops unit to user-facing XLM
 *
 * @param stroops - Amount in stroops
 * @returns Amount in XLM as string with proper decimal places
 *
 * @example
 * stroopsToXLM('100000000') // => '10'
 * stroopsToXLM('1') // => '0.0000001'
 */
export function stroopsToXLM(stroops: string | number): string {
  const stroopsNum = typeof stroops === 'string' ? parseFloat(stroops) : stroops;
  const xlm = stroopsNum / STROOPS_PER_XLM;
  // Format with up to 7 decimal places, removing trailing zeros
  return xlm.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 7,
  });
}

/**
 * Format XLM to stroops
 * Converts user-facing XLM to internal stroops unit for transactions
 *
 * @param xlm - Amount in XLM
 * @returns Amount in stroops as string (no decimals)
 *
 * @example
 * xlmToStroops('10') // => '100000000'
 * xlmToStroops('0.0000001') // => '1'
 */
export function xlmToStroops(xlm: string | number): string {
  const xlmNum = typeof xlm === 'string' ? parseFloat(xlm) : xlm;
  const stroops = Math.round(xlmNum * STROOPS_PER_XLM);
  return stroops.toString();
}

/**
 * Format balance for display
 * Rounds to specified decimal places and adds formatting
 *
 * @param balance - Balance amount as string
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted balance string
 *
 * @example
 * formatBalance('100.123456', 2) // => '100.12'
 * formatBalance('1000.5', 0) // => '1,000'
 */
export function formatBalance(balance: string, decimals: number = 2): string {
  const num = parseFloat(balance);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format public key for display (shortened)
 * Shows first and last 6 characters with ellipsis
 *
 * @param publicKey - Full public key
 * @returns Shortened key for display
 *
 * @example
 * shortenKey('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47')
 * // => 'GBRPY...HAZVF47'
 */
export function shortenKey(publicKey: string): string {
  if (publicKey.length <= 12) {
    return publicKey;
  }
  return `${publicKey.substring(0, 6)}...${publicKey.substring(publicKey.length - 6)}`;
}

/**
 * Format transaction hash for display
 * Shows first and last 6 characters with ellipsis
 *
 * @param hash - Full transaction hash
 * @returns Shortened hash for display
 *
 * @example
 * shortenHash('abc123def456...') // => 'abc12...456'
 */
export function shortenHash(hash: string): string {
  if (hash.length <= 12) {
    return hash;
  }
  return `${hash.substring(0, 6)}...${hash.substring(hash.length - 6)}`;
}

/**
 * Format amount as currency with locale
 * Handles very large and very small numbers
 *
 * @param amount - Amount as string or number
 * @param currency - Currency code (default: 'XLM')
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string like "1,234.56 XLM"
 *
 * @example
 * formatCurrency('1234.567', 'XLM', 2) // => '1,234.57 XLM'
 */
export function formatCurrency(amount: string | number, currency: string = 'XLM', decimals: number = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;

  if (isNaN(num)) {
    return `0 ${currency}`;
  }

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return `${formatted} ${currency}`;
}

/**
 * Format percentage change (e.g., for price displays)
 *
 * @param change - Change amount
 * @returns Formatted string like "+5.23%" or "-2.50%"
 *
 * @example
 * formatPercentage(5.23) // => '+5.23%'
 * formatPercentage(-2.50) // => '-2.50%'
 */
export function formatPercentage(change: number): string {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}
