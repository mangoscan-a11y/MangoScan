import { describe, it, expect } from 'vitest'
import { pivotDailyClassification, colorForLabel, toCsvRow } from '@/lib/classification'
import type { VDailyClassification } from '@/lib/database.types'

function row(overrides: Partial<VDailyClassification>): VDailyClassification {
  return {
    summary_date: '2026-08-20',
    dimension: 'variety',
    label: 'Carabao',
    count: 1,
    sort_order: 0,
    ...overrides,
  }
}

describe('pivotDailyClassification', () => {
  it('returns an empty array for undefined input', () => {
    expect(pivotDailyClassification(undefined, 'variety')).toEqual([])
  })

  it('filters to the requested dimension only', () => {
    const rows = [
      row({ dimension: 'variety', label: 'Carabao', count: 3 }),
      row({ dimension: 'disease', label: 'Healthy', count: 5 }),
    ]
    expect(pivotDailyClassification(rows, 'variety')).toEqual([{ name: 'Carabao', value: 3 }])
  })

  it('sums counts for the same label across multiple days', () => {
    const rows = [
      row({ summary_date: '2026-08-19', label: 'Carabao', count: 3, sort_order: 0 }),
      row({ summary_date: '2026-08-20', label: 'Carabao', count: 4, sort_order: 0 }),
    ]
    expect(pivotDailyClassification(rows, 'variety')).toEqual([{ name: 'Carabao', value: 7 }])
  })

  it('orders labels by sort_order, not by count or insertion order', () => {
    const rows = [
      row({ dimension: 'color', label: 'Overripe', count: 1, sort_order: 4 }),
      row({ dimension: 'color', label: 'Green', count: 9, sort_order: 1 }),
      row({ dimension: 'color', label: 'Ripe', count: 5, sort_order: 3 }),
      row({ dimension: 'color', label: 'Turning', count: 2, sort_order: 2 }),
    ]
    expect(pivotDailyClassification(rows, 'color').map((r) => r.name)).toEqual([
      'Green',
      'Turning',
      'Ripe',
      'Overripe',
    ])
  })
})

describe('colorForLabel', () => {
  it('assigns a fixed color to known outcome labels', () => {
    expect(colorForLabel('Healthy', 5)).toBe(colorForLabel('Healthy', 0))
  })

  it('gives disease labels distinct colors instead of collapsing to one fallback', () => {
    const known = colorForLabel('Anthracnose', 0)
    const unknownDisease = colorForLabel('Bacterial Black Spot', 1)
    expect(unknownDisease).not.toBe(known)
  })

  it('wraps around the palette for indexes beyond its length', () => {
    expect(colorForLabel('Some Label', 2)).toBe(colorForLabel('Other Label', 2 + 8))
  })
})

describe('toCsvRow', () => {
  it('joins plain values with commas', () => {
    expect(toCsvRow(['a', 1, 'b'])).toBe('a,1,b')
  })

  it('quotes and escapes a field containing a comma', () => {
    expect(toCsvRow(['Round, apple-sized', 'ok'])).toBe('"Round, apple-sized",ok')
  })

  it('quotes and escapes a field containing a double quote', () => {
    expect(toCsvRow(['5" wide', 'ok'])).toBe('"5"" wide",ok')
  })

  it('quotes a field containing a newline', () => {
    expect(toCsvRow(['line1\nline2'])).toBe('"line1\nline2"')
  })

  it('renders null and undefined as empty fields', () => {
    expect(toCsvRow([null, undefined, 'x'])).toBe(',,x')
  })
})
