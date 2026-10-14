import type { Db } from 'mongodb'
import { COLLECTIONS } from '../db.ts'
import type { EventHub } from '../events.ts'
import { applyBinReport, initialBins, type BinInfo } from './bin-state.ts'

/** Holds the current full/empty state of the eight bins, persisted so a restart remembers it. */
export class BinManager {
  private readonly db: Db
  private readonly hub: EventHub
  private bins: BinInfo[] = initialBins()

  constructor(db: Db, hub: EventHub) {
    this.db = db
    this.hub = hub
  }

  async load(): Promise<void> {
    const saved = await this.db
      .collection(COLLECTIONS.binStatus)
      .find({}, { projection: { _id: 0 } })
      .toArray()
    this.bins = initialBins().map((b) => {
      const s = saved.find((d) => d.bin_index === b.bin_index)
      return s ? { ...b, full: !!s.full, full_since: s.full_since ?? null, updated_at: s.updated_at ?? null } : b
    })
  }

  list(): BinInfo[] {
    return this.bins.map((b) => ({ ...b }))
  }

  fullSet(): Set<number> {
    return new Set(this.bins.filter((b) => b.full).map((b) => b.bin_index))
  }

  /** Apply a controller report. Returns true when it changed anything. */
  async report(bin: number, full: boolean): Promise<boolean> {
    const now = new Date()
    const { bins, changed } = applyBinReport(this.bins, { bin, full }, now)
    if (!changed) return false
    this.bins = bins
    const row = bins.find((b) => b.bin_index === bin)
    if (row) {
      await this.db.collection(COLLECTIONS.binStatus).replaceOne({ bin_index: bin }, row, { upsert: true })
    }
    await this.db.collection(COLLECTIONS.deviceEvents).insertOne({ ts: now, type: 'bin', bin, full })
    this.hub.emit('bin.updated', this.list())
    return true
  }
}
