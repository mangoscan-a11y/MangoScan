// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, mongoAvailable, type TestDb } from '../test/mongo.ts'
import { ensureIndexes, seedReference } from '../db.ts'
import { RefCache } from '../machine/ref-cache.ts'
import { dailySummary } from '../queries.ts'
import { manilaDateString } from '../lib/time.ts'
import { seedSampleScans } from './sample-data.ts'

const hasMongo = await mongoAvailable()

describe.skipIf(!hasMongo)('seedSampleScans', () => {
  let t: TestDb
  let refs: RefCache
  const now = new Date('2026-10-15T04:00:00Z')

  beforeAll(async () => {
    t = await createTestDb()
    await ensureIndexes(t.db)
    await seedReference(t.db)
    refs = new RefCache(t.db)
    await refs.load()
  })
  afterAll(async () => {
    await t.drop()
  })

  it('adds the requested number of well-formed scans from the last seven days', async () => {
    expect(await seedSampleScans(t.db, refs.get(), 30, now)).toBe(30)
    const docs = await t.db.collection('scans').find().toArray()
    expect(docs).toHaveLength(30)
    expect(new Set(docs.map((d) => d.scan_id)).size).toBe(30)
    const earliest = Date.parse('2026-10-08T00:00:00+08:00')
    for (const d of docs) {
      expect(d.scan_datetime.getTime()).toBeGreaterThanOrEqual(earliest)
      expect(d.scan_datetime.getTime()).toBeLessThanOrEqual(now.getTime())
      expect(d.sorting_log.actuation_status).toBe('success')
      expect(d.detections).toHaveLength(5)
    }
  })

  it('is visible in the daily summaries, adding up to everything seeded', async () => {
    const from = manilaDateString(new Date(now.getTime() - 8 * 86_400_000))
    const rows = await dailySummary(t.db, from, manilaDateString(now))
    expect(rows.reduce((n, r) => n + r.total_scanned, 0)).toBe(30)
    expect(rows.length).toBeGreaterThan(1)
  })

  it('is repeatable: the same seed gives the same fruit', async () => {
    const other = await createTestDb()
    await ensureIndexes(other.db)
    await seedReference(other.db)
    const r2 = new RefCache(other.db)
    await r2.load()
    await seedSampleScans(other.db, r2.get(), 30, now)
    const key = (d: Record<string, unknown>) => String(d.bin_assigned) + (d.scan_datetime as Date).toISOString()
    const a = (await t.db.collection('scans').find().sort({ scan_id: 1 }).toArray()).map(key)
    const b = (await other.db.collection('scans').find().sort({ scan_id: 1 }).toArray()).map(key)
    await other.drop()
    expect(b).toEqual(a)
  })
})
