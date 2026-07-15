/**
 * Sanctions screening evidence run (SOW Deliverable 3, Section 6):
 * proves the KYC gate blocks a sanctions-list match and clears an unrelated
 * submission, against the compliance-service HTTP API directly (same code
 * path the dashboard's KYCForm hits via POST /compliance/submit).
 *
 * Run: node --env-file=../../.env.local --import tsx scripts/sanctions-e2e.ts
 * (compliance-service must be running — see CLAUDE.md pnpm --filter command)
 */
import axios from 'axios';
import { initPostgres, query } from '@funti3r/database';

const BASE_URL = process.env.COMPLIANCE_SERVICE_URL || 'http://localhost:3003';

/** kyc_records.user_id is a real FK into users — create a throwaway worker
 * row per run (cleaned up at the end) rather than faking an id. */
async function createTestWorker(label: string): Promise<string> {
  const email = `sanctions-e2e-${label}-${Date.now()}@funti3r.test`;
  const result = await query(
    `INSERT INTO users (email, role) VALUES ($1, 'worker') RETURNING id`,
    [email],
  );
  return result.rows[0].id;
}

function kycPayload(userId: string, fullName: string) {
  return {
    userId,
    identity: {
      fullName,
      legalName: fullName,
      dateOfBirth: '1990-01-01',
      nationality: 'NG',
      countryOfResidence: 'NG',
    },
    bankAccount: {
      bankName: 'Demo Bank',
      accountHolderName: fullName,
      accountNumber: '0000000000',
      currency: 'NGN',
    },
  };
}

async function submit(label: string, fullName: string) {
  const userId = await createTestWorker(label);
  const res = await axios.post(`${BASE_URL}/submit`, kycPayload(userId, fullName), {
    validateStatus: () => true,
  });
  console.log(`\n[${label}] name="${fullName}" userId=${userId}`);
  console.log(`  status=${res.status} body=${JSON.stringify(res.data)}`);
  return { userId, ...res.data };
}

async function main() {
  console.log('=== Sanctions screening evidence run ===');
  console.log(`compliance-service: ${BASE_URL}`);

  await initPostgres();

  const createdUserIds: string[] = [];
  try {
    const clean = await submit('CLEAR', 'Adaeze Okonkwo');
    createdUserIds.push(clean.userId);
    if (clean.sanctions_status !== 'clear') {
      throw new Error(`expected clean submission to clear, got sanctions_status=${clean.sanctions_status}`);
    }

    const flagged = await submit('FLAGGED', 'Sanctions Test Subject');
    createdUserIds.push(flagged.userId);
    if (flagged.sanctions_status !== 'flagged' || flagged.status !== 'rejected') {
      throw new Error(`expected flagged submission to be rejected, got ${JSON.stringify(flagged)}`);
    }

    console.log('\n=== Result: clean submission cleared, sanctions-list match blocked. ===');
  } finally {
    if (createdUserIds.length > 0) {
      await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
      console.log(`\nCleaned up ${createdUserIds.length} throwaway test user(s).`);
    }
  }
}

main().catch((err) => {
  console.error('Sanctions e2e run FAILED:', err);
  process.exit(1);
});
