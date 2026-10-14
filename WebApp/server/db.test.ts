// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, mongoAvailable, type TestDb } from './test/mongo.ts'
import { ensureIndexes, nextScanId, seedReference } from './db.ts'

const hasMongo = await mongoAvailable()

describe.skipIf(!hasMongo)('database layer', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb()
    await ensureIndexes(t.db)
  })
  afterAll(async () => {
    await t.drop()
  })

  it('seeds the six varieties, three diseases, two colors and three size grades', async () => {
    await seedReference(t.db)
    const names = async (col: string, key: string) =>
      (await t.db.collection(col).find().sort({ [key]: 1 }).toArray()).map((d) => d[key.replace('_id', '_name')])
    expect(await names('mango_varieties', 'variety_id')).toEqual([
      'Carabao', 'Apple Mango', 'Indian', 'Chupadera', 'Wani', 'Kabayo',
    ])
    expect(await names('diseases', 'disease_id')).toEqual(['Healthy', 'Anthracnose', 'Mango Scab'])
    expect(await names('ripeness_levels', 'ripeness_id')).toEqual(['Green', 'Yellow'])
    expect(await names('size_grades', 'size_id')).toEqual(['Small', 'Medium', 'Large'])
  })

  it('seeds size grades that match the routing config gram ranges', async () => {
    const sizes = await t.db.collection('size_grades').find({}, { projection: { _id: 0 } }).sort({ sort_order: 1 }).toArray()
    expect(sizes.map((s) => [s.size_name, s.min_grams, s.max_grams])).toEqual([
      ['Small', 0, 200],
      ['Medium', 200, 350],
      ['Large', 350, null],
    ])
  })

  it('is idempotent and keeps a market price the operator edited', async () => {
    await t.db.collection('mango_varieties').updateOne({ variety_name: 'Carabao' }, { $set: { market_price: 999 } })
    await seedReference(t.db)
    expect(await t.db.collection('mango_varieties').countDocuments()).toBe(6)
    expect((await t.db.collection('mango_varieties').findOne({ variety_name: 'Carabao' }))?.market_price).toBe(999)
  })

  it('hands out unique, increasing scan ids even under concurrency', async () => {
    const ids = await Promise.all(Array.from({ length: 25 }, () => nextScanId(t.db)))
    expect(new Set(ids).size).toBe(25)
    expect(Math.max(...ids) - Math.min(...ids)).toBe(24)
    expect(await nextScanId(t.db)).toBeGreaterThan(Math.max(...ids))
  })

  it('refuses two scans with the same scan_id', async () => {
    const scans = t.db.collection('scans')
    await scans.insertOne({ scan_id: 7, scan_datetime: new Date() })
    await expect(scans.insertOne({ scan_id: 7, scan_datetime: new Date() })).rejects.toThrow(/duplicate key/i)
  })
})
