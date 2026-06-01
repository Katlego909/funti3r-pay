import { createClient, RedisClientType } from 'redis';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:Redis');

let client: RedisClientType | null = null;

export async function initRedis(): Promise<RedisClientType> {
  if (client) return client;

  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  client.on('error', (err) => {
    logger.error('Redis client error', { error: err.message });
  });

  try {
    await client.connect();
    await client.ping();
    logger.info('Connected to Redis');
  } catch (error) {
    logger.error('Failed to connect to Redis', { error: String(error) });
    throw error;
  }

  return client;
}

export async function getRedis(): Promise<RedisClientType> {
  if (!client) {
    await initRedis();
  }
  return client!;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed');
  }
}

export async function setKey(key: string, value: string, exSeconds?: number): Promise<void> {
  const redis = await getRedis();
  if (exSeconds) {
    await redis.setEx(key, exSeconds, value);
  } else {
    await redis.set(key, value);
  }
}

export async function getKey(key: string): Promise<string | null> {
  const redis = await getRedis();
  return redis.get(key);
}

export async function deleteKey(key: string): Promise<void> {
  const redis = await getRedis();
  await redis.del(key);
}

export async function setJSON<T>(key: string, value: T, exSeconds?: number): Promise<void> {
  await setKey(key, JSON.stringify(value), exSeconds);
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const value = await getKey(key);
  return value ? JSON.parse(value) : null;
}
