import { MongoClient, Db, Document } from 'mongodb';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Database:MongoDB');

let client: MongoClient | null = null;
let db: Db | null = null;

export async function initMongoDB(): Promise<Db> {
  if (db) return db;

  const mongoUrl = process.env.MONGODB_URL || 'mongodb://funti3r_dev:dev_password@localhost:27017/funti3r_analytics';

  client = new MongoClient(mongoUrl);

  try {
    await client.connect();
    db = client.db();
    await db.admin().ping();
    logger.info('Connected to MongoDB');
  } catch (error) {
    logger.error('Failed to connect to MongoDB', { error: String(error) });
    throw error;
  }

  return db;
}

export async function getMongoDB(): Promise<Db> {
  if (!db) {
    await initMongoDB();
  }
  return db!;
}

export async function closeMongoDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info('MongoDB connection closed');
  }
}

export async function getCollection<T extends Document = Document>(collectionName: string) {
  const database = await getMongoDB();
  return database.collection<T>(collectionName);
}
