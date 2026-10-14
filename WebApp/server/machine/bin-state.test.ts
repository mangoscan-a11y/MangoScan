// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyBinReport, initialBins } from './bin-state.ts'

const t0 = new Date('2026-10-15T01:00:00Z')
const t1 = new Date('2026-10-15T01:05:00Z')

describe('bin state', () => {
  it('starts with 8 empty bins', () => {
    const bins = initialBins()
    expect(bins).toHaveLength(8)
    expect(bins.every((b) => !b.full && b.full_since === null)).toBe(true)
    expect(bins.map((b) => b.bin_index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('marks a bin full and records when it filled', () => {
    const { bins, changed } = applyBinReport(initialBins(), { bin: 3, full: true }, t0)
    expect(changed).toBe(true)
    expect(bins[2]).toMatchObject({ bin_index: 3, full: true, full_since: t0.toISOString() })
  })

  it('ignores a repeated full report and keeps the original full_since', () => {
    const first = applyBinReport(initialBins(), { bin: 3, full: true }, t0).bins
    const again = applyBinReport(first, { bin: 3, full: true }, t1)
    expect(again.changed).toBe(false)
    expect(again.bins[2].full_since).toBe(t0.toISOString())
  })

  it('clears full_since when the bin is emptied', () => {
    const full = applyBinReport(initialBins(), { bin: 8, full: true }, t0).bins
    const { bins, changed } = applyBinReport(full, { bin: 8, full: false }, t1)
    expect(changed).toBe(true)
    expect(bins[7]).toMatchObject({ full: false, full_since: null })
  })

  it('does not mutate its input', () => {
    const before = initialBins()
    applyBinReport(before, { bin: 1, full: true }, t0)
    expect(before[0].full).toBe(false)
  })

  it.each([0, 9, -1, 2.5, Number.NaN])('ignores out-of-range bin %s', (bin) => {
    const { changed } = applyBinReport(initialBins(), { bin, full: true }, t0)
    expect(changed).toBe(false)
  })
})
