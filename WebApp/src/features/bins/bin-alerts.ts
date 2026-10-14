import type { BinStatus } from '@/lib/database.types'

const NAMES: Record<number, string> = {
  1: 'Diseased',
  2: 'Bruised',
  3: 'Green Small',
  4: 'Yellow Small',
  5: 'Green Medium',
  6: 'Yellow Medium',
  7: 'Green Large',
  8: 'Yellow Large',
}

/** How the operator refers to a bin, e.g. "Bin 3 · Green Large". */
export function binLabel(index: number): string {
  const name = NAMES[index]
  return name ? 'Bin ' + index + ' · ' + name : 'Bin ' + index
}

export function fullBins(bins: BinStatus[]): BinStatus[] {
  return bins.filter((b) => b.full).sort((a, b) => a.bin_index - b.bin_index)
}

/**
 * What changed between two snapshots. The very first snapshot reports nothing,
 * so opening the dashboard never fires an alert for a bin that was already full;
 * the banner covers that case.
 */
export function diffBins(
  prev: BinStatus[] | null,
  next: BinStatus[],
): { nowFull: BinStatus[]; nowEmpty: BinStatus[] } {
  if (prev === null) return { nowFull: [], nowEmpty: [] }
  const before = new Map(prev.map((b) => [b.bin_index, b.full]))
  return {
    nowFull: next.filter((b) => b.full && before.get(b.bin_index) === false),
    nowEmpty: next.filter((b) => !b.full && before.get(b.bin_index) === true),
  }
}
