// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, mongoAvailable, type TestDb } from './test/mongo.ts'
import { fixtureScan } from './test/fixtures.ts'
import { ensureIndexes, seedReference } from './db.ts'
import { RefCache } from './machine/ref-cache.ts'
import {
  dailyClassification,
  dailySummary,
  exportRows,
  latestScan,
  listScans,
  scanDetail,
} from './queries.ts'

const hasMongo = await mongoAvailable()

describe.skipIf(!hasMongo)('queries', () => {
  let t: TestDb
  let refs: RefCache

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

  it('has no latest scan before anything is stored', async () => {
    expect(await latestScan(t.db, refs.get())).toBeNull()
  })

  describe('with four scans across two Manila days', () => {
    beforeAll(async () => {
      const r = refs.get()
      await t.db.collection('scans').insertMany([
        fixtureScan(r, { id: 1, at: new Date('2026-10-14T01:00:00Z'), color: 'Green', size: 'Small' }),
        fixtureScan(r, { id: 2, at: new Date('2026-10-14T05:00:00Z'), variety: 'Wani', disease: 'Anthracnose', color: 'Yellow', size: 'Large' }),
        fixtureScan(r, { id: 3, at: new Date('2026-10-14T17:00:00Z'), bruised: true }),
        fixtureScan(r, { id: 4, at: new Date('2026-10-15T02:00:00Z'), color: 'Yellow', size: 'Medium', processing: 2.5 }),
      ])
    })

    const ids = (rows: { scan_id: number }[]) => rows.map((x) => x.scan_id)
    const base = { page: 1, pageSize: 15 }

    it('lists newest first and resolves the relations the UI shows', async () => {
      const { data, count } = await listScans(t.db, refs.get(), base)
      expect(count).toBe(4)
      expect(ids(data)).toEqual([4, 3, 2, 1])
      expect(data[3]).toMatchObject({
        scan_id: 1,
        variety_id: 1,
        mango_varieties: { variety_name: 'Carabao' },
        diseases: { disease_name: 'Healthy', severity_level: 'none' },
        ripeness_levels: { ripeness_name: 'Green' },
        size_grades: { size_name: 'Small' },
        quality_verdict: 'passed',
        bin_assigned: 'GREEN_SMALL',
        scan_datetime: '2026-10-14T01:00:00.000Z',
      })
    })

    it('filters by verdict, bruise, variety and disease', async () => {
      const f = async (extra: object) => ids((await listScans(t.db, refs.get(), { ...base, ...extra })).data)
      expect(await f({ verdict: 'rejected' })).toEqual([3, 2])
      expect(await f({ bruised: 'true' })).toEqual([3])
      expect(await f({ bruised: 'false' })).toEqual([4, 2, 1])
      expect(await f({ varietyId: 5 })).toEqual([2])
      expect(await f({ diseaseId: 2 })).toEqual([2])
      expect(await f({ ripenessId: 2 })).toEqual([4, 2])
      expect(await f({ sizeId: 3 })).toEqual([2])
      expect(await f({ verdict: 'rejected', varietyId: 1 })).toEqual([3])
    })

    it('treats the date filters as inclusive Manila calendar days', async () => {
      const f = async (dateFrom?: string, dateTo?: string) =>
        ids((await listScans(t.db, refs.get(), { ...base, dateFrom, dateTo })).data)
      expect(await f('2026-10-15', '2026-10-15')).toEqual([4, 3])
      expect(await f('2026-10-14', '2026-10-14')).toEqual([2, 1])
      expect(await f('2026-10-15')).toEqual([4, 3])
    })

    it('paginates and still reports the full count', async () => {
      const page2 = await listScans(t.db, refs.get(), { page: 2, pageSize: 2 })
      expect(ids(page2.data)).toEqual([2, 1])
      expect(page2.count).toBe(4)
    })

    it('returns the latest scan', async () => {
      expect((await latestScan(t.db, refs.get()))?.scan_id).toBe(4)
    })

    it('returns images, detections strongest first, and the sorting log for one scan', async () => {
      const d = await scanDetail(t.db, 2)
      expect(d?.detections).toHaveLength(5)
      expect(d?.log).toMatchObject({ scan_id: 2, gate_target: 'REJECT_DISEASED', actuation_status: 'pending' })
      expect(d?.images).toEqual([])
      expect(d?.decision_trace.length).toBeGreaterThan(0)
      expect(await scanDetail(t.db, 999)).toBeNull()
    })

    it('summarizes each Manila day, matching the old daily view', async () => {
      const rows = await dailySummary(t.db, '2026-10-14', '2026-10-15')
      expect(rows).toEqual([
        { summary_date: '2026-10-14', total_scanned: 2, total_passed: 1, total_rejected: 1, avg_confidence: 90, avg_processing_time: 1.5 },
        { summary_date: '2026-10-15', total_scanned: 2, total_passed: 1, total_rejected: 1, avg_confidence: 90, avg_processing_time: 2 },
      ])
      expect((await dailySummary(t.db, '2026-10-14', '2026-10-14')).map((r) => r.summary_date)).toEqual(['2026-10-14'])
      expect(await dailySummary(t.db, '2026-01-01', '2026-01-02')).toEqual([])
    })

    it('counts every label per day and dimension with the same sort order as before', async () => {
      const rows = await dailyClassification(t.db, refs.get(), '2026-10-15', '2026-10-15')
      const pick = (dimension: string) => rows.filter((r) => r.dimension === dimension).map((r) => [r.label, r.count, r.sort_order])
      expect(pick('variety')).toEqual([['Carabao', 2, 0]])
      expect(pick('disease')).toEqual([['Healthy', 2, 0]])
      expect(pick('bruise').sort()).toEqual([['Bruised', 1, 1], ['Not Bruised', 1, 0]])
      expect(pick('color').sort()).toEqual([['Green', 1, 1], ['Yellow', 1, 2]])
      expect(pick('size')).toEqual([['Medium', 2, 2]])
      expect(rows.every((r) => r.summary_date === '2026-10-15')).toBe(true)
    })

    it('exports one flat row per scan for the CSV download', async () => {
      const rows = await exportRows(t.db, '2026-10-14', '2026-10-14')
      expect(rows.map((r) => r.scan_id)).toEqual([2, 1])
      expect(rows[1]).toMatchObject({
        variety: 'Carabao',
        disease: 'Healthy',
        severity: 'none',
        color: 'Green',
        size: 'Small',
        quality_verdict: 'passed',
        bin_assigned: 'GREEN_SMALL',
        servo1_action: 'group_green',
        actuation_status: 'pending',
      })
    })
  })
})
