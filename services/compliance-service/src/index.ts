import express from 'express';
import { createLogger } from '@funti3r/shared-utils';
import { initPostgres, query, runInitialMigrations } from '@funti3r/database';
import { ComplianceStatus } from '@funti3r/shared-types';

const logger = createLogger('ComplianceService');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'compliance-service' });
});

// Submit KYC data
app.post('/verify', async (req, res) => {
  const { userId, idType, idNumber, country } = req.body;

  if (!userId || !idType || !idNumber || !country) {
    return res.status(400).json({ error: 'Missing required KYC fields' });
  }

  try {
    await query(
      `INSERT INTO kyc_records (user_id, status, id_type, id_number, country) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET 
       status = $2, id_type = $3, id_number = $4, country = $5, updated_at = NOW()`,
      [userId, ComplianceStatus.PENDING, idType, idNumber, country]
    );

    // Create audit log
    await query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId, 'KYC_SUBMISSION', JSON.stringify({ idType, country })]
    );

    res.status(201).json({ status: ComplianceStatus.PENDING });
  } catch (error) {
    logger.error('KYC submission failed', { userId, error: String(error) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check status
app.get('/:userId/status', async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await query('SELECT status FROM kyc_records WHERE user_id = $1', [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ status: result.rows[0].status });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function start() {
  try {
    await initPostgres();
    await runInitialMigrations();

    const PORT = parseInt(process.env.COMPLIANCE_SERVICE_PORT || '3003', 10);
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Compliance Service started on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start Compliance Service', { error: String(error) });
    process.exit(1);
  }
}

start();
