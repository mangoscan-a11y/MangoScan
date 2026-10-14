import type { Db } from 'mongodb'
import { COLLECTIONS, nextScanId } from '../db.ts'
import { manilaDateString } from '../lib/time.ts'
import { buildScanDocument } from '../machine/scan-builder.ts'
import type { RefData, ScanDoc } from '../types.ts'
import { randomOptions, simulateInference } from './simulate.ts'

const DAY_MS = 86_400_000

/** Small deterministic generator so a demo database looks the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Insert demo scans spread over the last week of working hours. Returns how many were added. */
export async function seedSampleScans(db: Db, refs: RefData, count: number, now: Date = new Date(), seed = 42): Promise<number> {
  const rng = mulberry32(seed)

  const moments: { at: Date; declared: string }[] = []
  for (let i = 0; i < count; i++) {
    let offset = Math.floor(rng() * 7)
    const minute = 8 * 60 + Math.floor(rng() * 9 * 60)
    const second = Math.floor(rng() * 60)
    const at = (o: number) => {
      const day = manilaDateString(new Date(now.getTime() - o * DAY_MS))
      return new Date(day + 'T' + pad(Math.floor(minute / 60)) + ':' + pad(minute % 60) + ':' + pad(second) + '+08:00')
    }
    let when = at(offset)
    if (when.getTime() > now.getTime()) {
      offset += 1
      when = at(offset)
    }
    // One variety per day, as on the real line where batches are pre-sorted.
    moments.push({ at: when, declared: refs.varieties[offset % refs.varieties.length].variety_name })
  }
  moments.sort((a, b) => a.at.getTime() - b.at.getTime())

  const docs: ScanDoc[] = []
  for (const m of moments) {
    const scanId = await nextScanId(db)
    const doc = buildScanDocument({
      scanId,
      now: m.at,
      processingSeconds: 1.2 + rng() * 2.6,
      inference: simulateInference(scanId, randomOptions(rng, m.declared)),
      refs,
      images: [],
      fullBins: new Set<number>(),
    })
    doc.sorting_log.actuation_status = 'success'
    doc.sorting_log.latency_ms = 80 + Math.floor(rng() * 120)
    docs.push(doc)
  }
  if (docs.length > 0) await db.collection(COLLECTIONS.scans).insertMany(docs)
  return docs.length
}
