import { describe, expect, it } from 'vitest'
import { binLabel, diffBins, fullBins } from '@/features/bins/bin-alerts'
import type { BinStatus } from '@/lib/database.types'

function bins(full: number[] = []): BinStatus[] {
  return Array.from({ length: 8 }, (_, i) => ({
    bin_index: i + 1,
    full: full.includes(i + 1),
    full_since: full.includes(i + 1) ? '2026-10-15T01:00:00.000Z' : null,
    updated_at: null,
  }))
}

const indexes = (list: BinStatus[]) => list.map((b) => b.bin_index)

describe('diffBins', () => {
  it('stays silent on the first snapshot, even if bins are already full', () => {
    const d = diffBins(null, bins([2, 5]))
    expect(d.nowFull).toEqual([])
    expect(d.nowEmpty).toEqual([])
  })

  it('reports a bin that has just filled', () => {
    const d = diffBins(bins(), bins([3]))
    expect(indexes(d.nowFull)).toEqual([3])
    expect(d.nowEmpty).toEqual([])
  })

  it('reports a bin that has just been emptied', () => {
    const d = diffBins(bins([3]), bins())
    expect(indexes(d.nowEmpty)).toEqual([3])
    expect(d.nowFull).toEqual([])
  })

  it('does not repeat an alert for a bin that was already full', () => {
    const d = diffBins(bins([3]), bins([3, 6]))
    expect(indexes(d.nowFull)).toEqual([6])
    expect(d.nowEmpty).toEqual([])
  })

  it('handles several changes at once', () => {
    const d = diffBins(bins([1, 2]), bins([2, 7, 8]))
    expect(indexes(d.nowFull)).toEqual([7, 8])
    expect(indexes(d.nowEmpty)).toEqual([1])
  })

  it('reports nothing when nothing changed', () => {
    const d = diffBins(bins([4]), bins([4]))
    expect(d.nowFull).toEqual([])
    expect(d.nowEmpty).toEqual([])
  })
})

describe('fullBins and binLabel', () => {
  it('lists only the full bins, in order', () => {
    expect(indexes(fullBins(bins([6, 2])))).toEqual([2, 6])
  })

  it('names bins the way the operator sees the machine', () => {
    expect(binLabel(1)).toBe('Bin 1 · Diseased')
    expect(binLabel(2)).toBe('Bin 2 · Bruised')
    expect(binLabel(3)).toBe('Bin 3 · Green Small')
    expect(binLabel(4)).toBe('Bin 4 · Yellow Small')
    expect(binLabel(5)).toBe('Bin 5 · Green Medium')
    expect(binLabel(6)).toBe('Bin 6 · Yellow Medium')
    expect(binLabel(7)).toBe('Bin 7 · Green Large')
    expect(binLabel(8)).toBe('Bin 8 · Yellow Large')
  })

  it('falls back gracefully for an unknown bin', () => {
    expect(binLabel(42)).toBe('Bin 42')
  })
})
