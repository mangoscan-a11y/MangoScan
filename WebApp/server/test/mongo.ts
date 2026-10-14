import { MongoClient, type Db } from 'mongodb'

export const TEST_MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017'

export async function mongoAvailable(): Promise<boolean> {
  const client = new MongoClient(TEST_MONGO_URI, { serverSelectionTimeoutMS: 800 })
  try {
    await client.connect()
    await client.db('admin').command({ ping: 1 })
    return true
  } catch {
    return false
  } finally {
    await client.close().catch(() => {})
  }
}

export interface TestDb {
  db: Db
  client: MongoClient
  drop(): Promise<void>
}

/** A throwaway database so tests never touch the real mangoscan data. */
export async function createTestDb(): Promise<TestDb> {
  const client = new MongoClient(TEST_MONGO_URI, { serverSelectionTimeoutMS: 2000 })
  await client.connect()
  const name = 'mangoscan_test_' + Math.random().toString(36).slice(2, 10)
  const db = client.db(name)
  return {
    db,
    client,
    async drop() {
      await db.dropDatabase()
      await client.close()
    },
  }
}
