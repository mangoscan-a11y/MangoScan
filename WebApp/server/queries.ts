import type { Db, Filter } from 'mongodb'
import type {
  ClassificationDimension,
  ExportRow,
  ScanDetail,
  ScanSessionWithRelations,
  VDailyClassification,
  VDailySummary,
} from '../src/lib/database.types.ts'
import { COLLECTIONS } from './db.ts'
import { manilaDayRange } from './lib/time.ts'
import type { RefData, ScanDoc } from './types.ts'

const MANILA = 'Asia/Manila'
const round2 = (n: number) => Math.round(n * 100) / 100

export interface ScanFilters {
  verdict?: 'passed' | 'rejected'
  varietyId?: number
  diseaseId?: number
  ripenessId?: number
  sizeId?: number
  bruised?: 'true' | 'false'
  dateFrom?: string
  dateTo?: string
  page: number
  pageSize: number
}

function scans(db: Db) {
  return db.collection<ScanDoc>(COLLECTIONS.scans)
}

export function toScanRow(doc: ScanDoc, refs: RefData): ScanSessionWithRelations {
  return {
    scan_id: doc.scan_id,
    variety_id: doc.variety?.variety_id ?? null,
    disease_id: doc.disease?.disease_id ?? null,
    ripeness_id: doc.ripeness?.ripeness_id ?? null,
    size_id: doc.size?.size_id ?? null,
    is_bruised: doc.is_bruised,
    bruise_confidence: doc.bruise_confidence,
    quality_verdict: doc.quality_verdict,
    confidence_score: doc.confidence_score,
    processing_time: doc.processing_time,
    bin_assigned: doc.bin_assigned,
    bin_index: doc.bin_index,
    reason_code: doc.reason_code,
    alerts: doc.alerts,
    declared_variety: doc.declared_variety,
    variety_match: doc.variety_match,
    scan_datetime: doc.scan_datetime.toISOString(),
    mango_varieties: refs.varieties.find((v) => v.variety_id === doc.variety?.variety_id) ?? null,
    diseases: refs.diseases.find((d) => d.disease_id === doc.disease?.disease_id) ?? null,
    ripeness_levels: refs.ripeness.find((r) => r.ripeness_id === doc.ripeness?.ripeness_id) ?? null,
    size_grades: refs.sizes.find((s) => s.size_id === doc.size?.size_id) ?? null,
  }
}

export async function listScans(
  db: Db,
  refs: RefData,
  f: ScanFilters,
): Promise<{ data: ScanSessionWithRelations[]; count: number }> {
  // Built field by field from validated values, never by spreading client input.
  const filter: Filter<ScanDoc> = {}
  if (f.verdict) filter.quality_verdict = f.verdict
  if (f.varietyId !== undefined) filter['variety.variety_id'] = f.varietyId
  if (f.diseaseId !== undefined) filter['disease.disease_id'] = f.diseaseId
  if (f.ripenessId !== undefined) filter['ripeness.ripeness_id'] = f.ripenessId
  if (f.sizeId !== undefined) filter['size.size_id'] = f.sizeId
  if (f.bruised) filter.is_bruised = f.bruised === 'true'
  if (f.dateFrom || f.dateTo) {
    const range: { $gte?: Date; $lt?: Date } = {}
    if (f.dateFrom) range.$gte = manilaDayRange(f.dateFrom, f.dateFrom).gte
    if (f.dateTo) range.$lt = manilaDayRange(f.dateTo, f.dateTo).lt
    filter.scan_datetime = range
  }

  const [docs, count] = await Promise.all([
    scans(db)
      .find(filter, { projection: { _id: 0 } })
      .sort({ scan_datetime: -1, scan_id: -1 })
      .skip((f.page - 1) * f.pageSize)
      .limit(f.pageSize)
      .toArray(),
    scans(db).countDocuments(filter),
  ])
  return { data: docs.map((d) => toScanRow(d, refs)), count }
}

export async function latestScan(db: Db, refs: RefData): Promise<ScanSessionWithRelations | null> {
  const doc = await scans(db).find({}, { projection: { _id: 0 } }).sort({ scan_datetime: -1, scan_id: -1 }).limit(1).next()
  return doc ? toScanRow(doc, refs) : null
}

export async function scanDetail(db: Db, scanId: number): Promise<ScanDetail | null> {
  const doc = await scans(db).findOne({ scan_id: scanId }, { projection: { _id: 0 } })
  if (!doc) return null
  return {
    images: [...doc.images]
      .sort((a, b) => a.angle_sequence - b.angle_sequence)
      .map((i) => ({ ...i, captured_at: i.captured_at.toISOString() })),
    detections: [...doc.detections].sort((a, b) => b.confidence - a.confidence),
    log: { ...doc.sorting_log, actuation_status: doc.sorting_log.actuation_status, logged_at: doc.sorting_log.logged_at.toISOString() },
    decision_trace: doc.decision_trace,
  }
}

const dayOf = { $dateToString: { format: '%Y-%m-%d', date: '$scan_datetime', timezone: MANILA } }

export async function dailySummary(db: Db, from: string, to: string): Promise<VDailySummary[]> {
  const range = manilaDayRange(from, to)
  const rows = await scans(db)
    .aggregate<{
      _id: string
      total_scanned: number
      total_passed: number
      total_rejected: number
      avg_confidence: number | null
      avg_processing_time: number | null
    }>([
      { $match: { scan_datetime: { $gte: range.gte, $lt: range.lt } } },
      {
        $group: {
          _id: dayOf,
          total_scanned: { $sum: 1 },
          total_passed: { $sum: { $cond: [{ $eq: ['$quality_verdict', 'passed'] }, 1, 0] } },
          total_rejected: { $sum: { $cond: [{ $eq: ['$quality_verdict', 'rejected'] }, 1, 0] } },
          avg_confidence: { $avg: '$confidence_score' },
          avg_processing_time: { $avg: '$processing_time' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray()
  return rows.map((r) => ({
    summary_date: r._id,
    total_scanned: r.total_scanned,
    total_passed: r.total_passed,
    total_rejected: r.total_rejected,
    avg_confidence: r.avg_confidence === null ? null : round2(r.avg_confidence),
    avg_processing_time: r.avg_processing_time === null ? null : round2(r.avg_processing_time),
  }))
}

const unknown = (path: string) => ({ $ifNull: [path, 'Unknown'] })

export async function dailyClassification(
  db: Db,
  refs: RefData,
  from: string,
  to: string,
): Promise<VDailyClassification[]> {
  const range = manilaDayRange(from, to)
  const countBy = (label: string) => [{ $group: { _id: { date: '$date', label: '$' + label }, count: { $sum: 1 } } }]

  type Grouped = { _id: { date: string; label: string }; count: number }
  const [facets] = await scans(db)
    .aggregate<Record<ClassificationDimension, Grouped[]>>([
      { $match: { scan_datetime: { $gte: range.gte, $lt: range.lt } } },
      {
        $project: {
          date: dayOf,
          variety: unknown('$variety.variety_name'),
          disease: unknown('$disease.disease_name'),
          bruise: {
            $switch: {
              branches: [
                { case: { $eq: ['$is_bruised', true] }, then: 'Bruised' },
                { case: { $eq: ['$is_bruised', false] }, then: 'Not Bruised' },
              ],
              default: 'Unknown',
            },
          },
          color: unknown('$ripeness.ripeness_name'),
          size: unknown('$size.size_name'),
        },
      },
      {
        $facet: {
          variety: countBy('variety'),
          disease: countBy('disease'),
          bruise: countBy('bruise'),
          color: countBy('color'),
          size: countBy('size'),
        },
      },
    ])
    .toArray()

  const colorOrder = new Map(refs.ripeness.map((r) => [r.ripeness_name, r.sort_order]))
  const sizeOrder = new Map(refs.sizes.map((s) => [s.size_name, s.sort_order]))
  const sortFor = (dimension: ClassificationDimension, label: string): number => {
    switch (dimension) {
      case 'bruise':
        return label === 'Bruised' ? 1 : label === 'Not Bruised' ? 0 : 2
      case 'color':
        return colorOrder.get(label) ?? 99
      case 'size':
        return sizeOrder.get(label) ?? 99
      default:
        return 0
    }
  }

  const dimensions: ClassificationDimension[] = ['variety', 'disease', 'bruise', 'color', 'size']
  const rows: VDailyClassification[] = []
  for (const dimension of dimensions) {
    for (const g of facets?.[dimension] ?? []) {
      rows.push({
        summary_date: g._id.date,
        dimension,
        label: g._id.label,
        count: g.count,
        sort_order: sortFor(dimension, g._id.label),
      })
    }
  }
  return rows.sort(
    (a, b) =>
      a.summary_date.localeCompare(b.summary_date) ||
      dimensions.indexOf(a.dimension) - dimensions.indexOf(b.dimension) ||
      a.sort_order - b.sort_order ||
      a.label.localeCompare(b.label),
  )
}

export async function exportRows(db: Db, from: string, to: string): Promise<ExportRow[]> {
  const range = manilaDayRange(from, to)
  const docs = await scans(db)
    .find({ scan_datetime: { $gte: range.gte, $lt: range.lt } }, { projection: { _id: 0 } })
    .sort({ scan_datetime: -1, scan_id: -1 })
    .toArray()
  return docs.map((d) => ({
    scan_id: d.scan_id,
    scan_datetime: d.scan_datetime.toISOString(),
    variety: d.variety?.variety_name ?? null,
    disease: d.disease?.disease_name ?? null,
    severity: d.disease?.severity_level ?? null,
    is_bruised: d.is_bruised,
    color: d.ripeness?.ripeness_name ?? null,
    size: d.size?.size_name ?? null,
    quality_verdict: d.quality_verdict,
    confidence_score: d.confidence_score,
    processing_time: d.processing_time,
    bin_assigned: d.bin_assigned,
    reason_code: d.reason_code,
    alerts: d.alerts,
    servo1_action: d.sorting_log.servo1_action,
    servo2_action: d.sorting_log.servo2_action,
    gate_target: d.sorting_log.gate_target,
    actuation_status: d.sorting_log.actuation_status,
    latency_ms: d.sorting_log.latency_ms,
  }))
}
