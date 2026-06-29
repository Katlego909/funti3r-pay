/**
 * Stellar Address and Amount Validation
 * Validates public keys, secret keys, and amounts according to Stellar specs
 */

/**
 * Validate Stellar public key format
 * Must be exactly 56 characters and start with 'G'
 *
 * @param publicKey - The public key to validate
 * @returns true if valid, false otherwise
 *
 * @example
 * validatePublicKey('GBRPYHIL2CI3WHZDTOOQFC6EB4RRJIGJESTZPFYAUMXTQFAM4HAZVF47')
 * // => true
 */
export function validatePublicKey(publicKey: string): boolean {
  if (!publicKey || typeof publicKey !== 'string') {
    return false;
  }
  // Stellar public keys: 56 chars, start with 'G', base32 encoded
  const publicKeyRegex = /^G[A-Z2-7]{54}$/;
  return publicKeyRegex.test(publicKey);
}

/**
 * Validate Stellar secret key format
 * Must be exactly 56 characters and start with 'S'
 *
 * @param secretKey - The secret key to validate
 * @returns true if valid, false otherwise
 */
export function validateSecretKey(secretKey: string): boolean {
  if (!secretKey || typeof secretKey !== 'string') {
    return false;
  }
  // Stellar secret keys: 56 chars, start with 'S', base32 encoded
  const secretKeyRegex = /^S[A-Z2-7]{54}$/;
  return secretKeyRegex.test(secretKey);
}

/**
 * Validate payment amount
 * Must be a positive number with up to 7 decimal places
 *
 * @param amount - The amount as a string
 * @returns true if valid, false otherwise
 *
 * @example
 * validateAmount('100.50')  // => true
 * validateAmount('0.0000001') // => true
 * validateAmount('-50') // => false
 * validateAmount('abc') // => false
 */
export function validateAmount(amount: string): boolean {
  if (!amount || typeof amount !== 'string') {
    return false;
  }

  const numAmount = parseFloat(amount);

  // Must be a valid number
  if (isNaN(numAmount)) {
    return false;
  }

  // Must be positive
  if (numAmount <= 0) {
    return false;
  }

  // Check decimal places (Stellar supports up to 7 decimal places)
  const parts = amount.split('.');
  if (parts.length > 2) {
    return false;
  }

  if (parts.length === 2 && parts[1].length > 7) {
    return false;
  }

  return true;
}

/**
 * Validate asset code format
 * Must be 1-12 alphanumeric characters
 *
 * @param assetCode - The asset code to validate
 * @returns true if valid, false otherwise
 */
export function validateAssetCode(assetCode: string): boolean {
  if (!assetCode || typeof assetCode !== 'string') {
    return false;
  }
  // Asset codes: 1-12 alphanumeric characters
  const assetCodeRegex = /^[a-zA-Z0-9]{1,12}$/;
  return assetCodeRegex.test(assetCode);
}

/**
 * Comprehensive validation for payment parameters
 *
 * @param fromPublicKey - Sender's public key
 * @param toPublicKey - Recipient's public key
 * @param amount - Payment amount
 * @throws Error if validation fails
 */
export function validatePaymentParams(
  fromPublicKey: string,
  toPublicKey: string,
  amount: string
): void {
  if (!validatePublicKey(fromPublicKey)) {
    throw new Error(`Invalid sender public key: ${fromPublicKey}`);
  }

  if (!validatePublicKey(toPublicKey)) {
    throw new Error(`Invalid recipient public key: ${toPublicKey}`);
  }

  if (fromPublicKey === toPublicKey) {
    throw new Error('Cannot send payment to the same account');
  }

  if (!validateAmount(amount)) {
    throw new Error(`Invalid amount: ${amount}. Must be positive with max 7 decimal places`);
  }
}
