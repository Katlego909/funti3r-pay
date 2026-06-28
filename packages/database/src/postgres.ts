import { Pool, PoolClient } from 'pg';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:PostgreSQL');

let pool: Pool | null = null;

export async function initPostgres(): Promise<Pool> {
  if (pool) return pool;

  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://funti3r_dev:dev_password@127.0.0.1:5432/funti3r_dev';

  const config = {
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  };

  logger.info('Initializing PostgreSQL connection', {
    host: new URL(connectionString.replace('postgresql://', 'http://')).hostname,
  });

  pool = new Pool(config);

  pool.on('error', (err: Error) => {
    logger.error('Unexpected error on idle client', { error: err.message });
  });

  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    logger.info('Connected to PostgreSQL');
  } catch (error) {
    logger.error('Failed to connect to PostgreSQL', { error: String(error) });
    throw error;
  }

  return pool;
}

export async function getPostgres(): Promise<Pool> {
  if (!pool) {
    await initPostgres();
  }
  return pool!;
}

export async function closePostgres(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL connection closed');
  }
}

export async function query(sql: string, params?: unknown[]) {
  const db = await getPostgres();
  return db.query(sql, params);
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const db = await getPostgres();
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
