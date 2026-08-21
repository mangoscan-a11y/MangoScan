import type { ClassificationDimension, VDailyClassification } from './database.types'

export interface DimensionMeta {
  key: ClassificationDimension
  label: string
}

export const DIMENSIONS: DimensionMeta[] = [
  { key: 'variety', label: 'Variety' },
  { key: 'disease', label: 'Disease' },
  { key: 'bruise', label: 'Bruise' },
  { key: 'color', label: 'Color (Ripeness)' },
  { key: 'size', label: 'Size' },
]

export interface LabelCount {
  name: string
  value: number
}

/**
 * Collapses the long-format v_daily_classification rows for one dimension
 * into chart-ready { name, value } pairs, summed across the date range and
 * ordered by the reference tables' sort_order (falls back to insertion
 * order for dimensions with no natural order, e.g. variety/disease).
 */
export function pivotDailyClassification(
  rows: VDailyClassification[] | undefined,
  dimension: ClassificationDimension,
): LabelCount[] {
  if (!rows) return []

  const totals = new Map<string, number>()
  const order = new Map<string, number>()

  for (const row of rows) {
    if (row.dimension !== dimension) continue
    totals.set(row.label, (totals.get(row.label) ?? 0) + row.count)
    if (!order.has(row.label)) order.set(row.label, row.sort_order)
  }

  return Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0))
}

const SEMANTIC_COLORS: Record<string, string> = {
  Healthy: '#22c55e',
  'Not Bruised': '#22c55e',
  Passed: '#22c55e',
  Anthracnose: '#ef4444',
  Bruised: '#ef4444',
  Rejected: '#ef4444',
  'Mango Scab': '#f97316',
  Unknown: '#64748b',
}

const PALETTE = ['#eab308', '#f97316', '#22c55e', '#6366f1', '#ec4899', '#14b8a6', '#a855f7', '#0ea5e9']

/**
 * Picks a chart color for a classification label. Known outcome labels
 * (Healthy, Bruised, ...) get a fixed semantic color; everything else
 * rotates through PALETTE by its index so an unrecognized label (e.g. a
 * newly added disease) never silently inherits another label's color.
 */
export function colorForLabel(label: string, index: number): string {
  return SEMANTIC_COLORS[label] ?? PALETTE[index % PALETTE.length]
}

/**
 * Quotes a CSV field per RFC 4180 when it contains a comma, quote, or
 * newline. Plain values are returned unchanged.
 */
function quoteCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function toCsvRow(values: Array<string | number | null | undefined>): string {
  return values.map((v) => quoteCsvField(v === null || v === undefined ? '' : String(v))).join(',')
}
