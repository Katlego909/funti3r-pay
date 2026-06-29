#!/usr/bin/env tsx
/**
 * Setup test data for payment testing on testnet
 * Creates an enterprise user, worker user, wallets, and KYC verification
 *
 * Usage:
 *   pnpm exec tsx setup-test-data.ts
 *
 * This creates real users ready for testing cross-border payments
 */

import { randomUUID } from 'crypto';
import { initPostgres, query, runInitialMigrations } from '@funti3r/database';

async function setupTestData() {
  try {
    await initPostgres();
    console.log('✓ Connected to PostgreSQL');

    // Run migrations to ensure schema exists
    await runInitialMigrations();
    console.log('✓ Migrations complete\n');

    // Create enterprise user
    const enterpriseId = randomUUID();
    const enterpriseEmail = 'enterprise@test.funti3r.com';
    console.log(`Creating enterprise user: ${enterpriseEmail}`);

    await query(
      `INSERT INTO users (id, email, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (email) DO NOTHING`,
      [enterpriseId, enterpriseEmail, 'enterprise', 'active']
    );

    // Create worker user
    const workerId = randomUUID();
    const workerEmail = 'worker@test.funti3r.com';
    console.log(`Creating worker user: ${workerEmail}`);

    await query(
      `INSERT INTO users (id, email, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (email) DO NOTHING`,
      [workerId, workerEmail, 'worker', 'active']
    );

    // Get existing user IDs if they already existed
    const existingEnterprise = await query(
      `SELECT id FROM users WHERE email = $1`,
      [enterpriseEmail]
    );
    const existingWorker = await query(
      `SELECT id FROM users WHERE email = $1`,
      [workerEmail]
    );

    const actualEnterpriseId = existingEnterprise.rows[0]?.id || enterpriseId;
    const actualWorkerId = existingWorker.rows[0]?.id || workerId;

    // Create enterprise platform wallet with a real Stellar testnet account
    // This is a pre-generated test keypair (funded on testnet)
    const enterprisePublicKey = 'GB7VG3ONGDRPTW3OS3ZPHQPZ6FQFBBBZ5V4QJGWQWCKGZQMVQXTCXWJ';
    const enterpriseWalletId = randomUUID();
    console.log(`Creating enterprise platform wallet`);

    await query(
      `INSERT INTO wallets (id, user_id, wallet_type, public_key, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id, wallet_type, is_external) DO NOTHING`,
      [enterpriseWalletId, actualEnterpriseId, 'enterprise', enterprisePublicKey, 'active']
    );

    // Create worker SmartWallet contract placeholder
    // In reality, this would be deployed by the payment service during registration
    // For now, we're using a placeholder contract address
    const workerContractAddress = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const workerWalletId = randomUUID();
    console.log(`Creating worker SmartWallet contract reference`);

    await query(
      `INSERT INTO wallets (id, user_id, wallet_type, contract_address, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (user_id, wallet_type, is_external) DO NOTHING`,
      [workerWalletId, actualWorkerId, 'worker', workerContractAddress, 'active']
    );

    // Set KYC verification for worker (so they can receive payments)
    console.log(`Setting KYC verification for worker`);

    await query(
      `INSERT INTO kyc_records
       (user_id, tier, status, full_name, legal_name, date_of_birth,
        nationality, country_of_residence, verified_at, id_verified_at,
        address_verified_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW(), NOW(), NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [
        actualWorkerId,
        'tier1',
        'verified',
        'Test Worker',
        'Test Worker',
        '1990-01-01',
        'US',
        'NG'
      ]
    );

    console.log('\n✅ Test data created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Enterprise Credentials:');
    console.log(`  Email:          ${enterpriseEmail}`);
    console.log(`  User ID:        ${actualEnterpriseId}`);
    console.log(`  Wallet Type:    Platform (encrypted private key)`);
    console.log(`  Stellar Acct:   ${enterprisePublicKey}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Worker Credentials:');
    console.log(`  Email:          ${workerEmail}`);
    console.log(`  User ID:        ${actualWorkerId}`);
    console.log(`  Wallet Type:    Soroban SmartWallet`);
    console.log(`  Contract Addr:  ${workerContractAddress}`);
    console.log(`  KYC Status:     VERIFIED ✓`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('📝 Next Steps:');
    console.log('1. Open Enterprise Dashboard: http://localhost:3103');
    console.log('   (or 3100 if available, check console output)');
    console.log('2. In Payment form, enter Worker ID:');
    console.log(`   ${actualWorkerId}`);
    console.log('3. Enter amount (e.g., 100 USD)');
    console.log('4. Select Stellar rail and submit');
    console.log('5. Check payment status in Payments list\n');

    console.log('🔗 Verify on Stellar Testnet:');
    console.log(`   https://stellar.expert/explorer/testnet/account/${enterprisePublicKey}`);
    console.log('   (check balances and recent transactions)\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error) {
      console.error('   Stack:', error.stack);
    }
    process.exit(1);
  }
}

setupTestData();
