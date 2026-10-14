import { MongoClient, type Db } from 'mongodb'
import { DISEASES, RIPENESS_LEVELS, SIZE_GRADES, VARIETIES } from './reference-data.ts'

export const COLLECTIONS = {
  varieties: 'mango_varieties',
  diseases: 'diseases',
  ripeness: 'ripeness_levels',
  sizes: 'size_grades',
  scans: 'scans',
  binStatus: 'bin_status',
  deviceEvents: 'device_events',
  settings: 'settings',
  counters: 'counters',
} as const

export interface DbHandle {
  client: MongoClient
  db: Db
}

export async function connectDb(uri: string, dbName: string): Promise<DbHandle> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 })
  try {
    await client.connect()
    await client.db('admin').command({ ping: 1 })
  } catch (err) {
    await client.close().catch(() => {})
    throw new Error(
      `Cannot reach MongoDB at ${uri}. Is the MongoDB service running? (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  return { client, db: client.db(dbName) }
}

export async function ensureIndexes(db: Db): Promise<void> {
  const unique = { unique: true }
  await Promise.all([
    db.collection(COLLECTIONS.varieties).createIndexes([{ key: { variety_id: 1 }, ...unique }, { key: { variety_name: 1 }, ...unique }]),
    db.collection(COLLECTIONS.diseases).createIndexes([{ key: { disease_id: 1 }, ...unique }, { key: { disease_name: 1 }, ...unique }]),
    db.collection(COLLECTIONS.ripeness).createIndexes([{ key: { ripeness_id: 1 }, ...unique }, { key: { ripeness_name: 1 }, ...unique }]),
    db.collection(COLLECTIONS.sizes).createIndexes([{ key: { size_id: 1 }, ...unique }, { key: { size_name: 1 }, ...unique }]),
    db.collection(COLLECTIONS.scans).createIndexes([
      { key: { scan_id: 1 }, ...unique },
      { key: { scan_datetime: -1 } },
      { key: { quality_verdict: 1, scan_datetime: -1 } },
      { key: { 'variety.variety_id': 1 } },
      { key: { 'disease.disease_id': 1 } },
      { key: { 'ripeness.ripeness_id': 1 } },
      { key: { 'size.size_id': 1 } },
      { key: { is_bruised: 1 } },
    ]),
    db.collection(COLLECTIONS.binStatus).createIndexes([{ key: { bin_index: 1 }, ...unique }]),
    // Device history is only useful for a while; let MongoDB expire it.
    db.collection(COLLECTIONS.deviceEvents).createIndexes([{ key: { ts: 1 }, expireAfterSeconds: 60 * 60 * 24 * 30 }]),
  ])
}

/**
 * Insert reference rows that are missing. Existing rows are left alone so an
 * operator's edits (market prices) survive a re-seed.
 */
export async function seedReference(db: Db): Promise<void> {
  const seed = async (collection: string, idField: string, rows: object[]) => {
    const col = db.collection(collection)
    for (const row of rows) {
      const id = (row as Record<string, unknown>)[idField]
      await col.updateOne({ [idField]: id }, { $setOnInsert: row }, { upsert: true })
    }
  }
  await seed(COLLECTIONS.varieties, 'variety_id', VARIETIES)
  await seed(COLLECTIONS.diseases, 'disease_id', DISEASES)
  await seed(COLLECTIONS.ripeness, 'ripeness_id', RIPENESS_LEVELS)
  await seed(COLLECTIONS.sizes, 'size_id', SIZE_GRADES)
}

export async function nextScanId(db: Db): Promise<number> {
  const doc = await db
    .collection<{ _id: string; seq: number }>(COLLECTIONS.counters)
    .findOneAndUpdate({ _id: 'scan_id' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' })
  if (!doc) throw new Error('scan id counter unavailable')
  return doc.seq
}

/** Make sure the counter is never behind the highest stored scan (e.g. after an import). */
export async function syncScanCounter(db: Db): Promise<void> {
  const top = await db.collection(COLLECTIONS.scans).find({}, { projection: { scan_id: 1 } }).sort({ scan_id: -1 }).limit(1).next()
  if (!top) return
  await db
    .collection<{ _id: string; seq: number }>(COLLECTIONS.counters)
    .updateOne({ _id: 'scan_id' }, { $max: { seq: top.scan_id as number } }, { upsert: true })
}
