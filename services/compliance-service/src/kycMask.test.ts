import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskForReview, maskValue } from './kycMask.js';

test('masks all but the last four characters, and short values whole', () => {
  assert.equal(maskValue('8001015009087'), '•••• 9087');
  assert.equal(maskValue('123'), '••••');
  assert.equal(maskValue(''), '');
  assert.equal(maskValue(undefined), undefined);
});

test('masks identifying fields in any section, or stored flat, and leaves the rest readable', () => {
  const masked = maskForReview({
    identity: { fullName: 'Thandi Nkosi', dateOfBirth: '1980-01-01', idNumber: '8001015009087', nationality: 'ZA' },
    governmentId: { idType: 'passport', idNumber: 'A12345678' },
    address: { streetAddress: '12 Main Rd', city: 'Johannesburg', postalCode: '2001' },
    taxInfo: { taxId: '9876543210' },
    bankAccount: { bankName: 'FNB', accountNumber: '1234567890', iban: 'ZA00FNB1234567890' },
    accountNumber: '5555666677', // an older, flat submission
  });
  assert.deepEqual(masked, {
    identity: { fullName: 'Thandi Nkosi', dateOfBirth: '•••• 1-01', idNumber: '•••• 9087', nationality: 'ZA' },
    governmentId: { idType: 'passport', idNumber: '•••• 5678' },
    address: { streetAddress: '•••• n Rd', city: 'Johannesburg', postalCode: '••••' },
    taxInfo: { taxId: '•••• 3210' },
    bankAccount: { bankName: 'FNB', accountNumber: '•••• 7890', iban: '•••• 7890' },
    accountNumber: '•••• 6677',
  });
});
