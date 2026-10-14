export const BIN_COUNT = 8

export interface BinInfo {
  bin_index: number
  full: boolean
  full_since: string | null
  updated_at: string | null
}

export function initialBins(): BinInfo[] {
  return Array.from({ length: BIN_COUNT }, (_, i) => ({
    bin_index: i + 1,
    full: false,
    full_since: null,
    updated_at: null,
  }))
}

/** Pure reducer for a controller's bin-full report. Never mutates `bins`. */
export function applyBinReport(
  bins: BinInfo[],
  report: { bin: number; full: boolean },
  now: Date,
): { bins: BinInfo[]; changed: boolean } {
  const { bin, full } = report
  if (!Number.isInteger(bin) || bin < 1 || bin > BIN_COUNT) return { bins, changed: false }

  const current = bins.find((b) => b.bin_index === bin)
  if (!current || current.full === full) return { bins, changed: false }

  const stamp = now.toISOString()
  const next = bins.map((b) =>
    b.bin_index === bin ? { ...b, full, full_since: full ? stamp : null, updated_at: stamp } : b,
  )
  return { bins: next, changed: true }
}
