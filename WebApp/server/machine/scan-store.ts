import type { Db } from 'mongodb'
import { COLLECTIONS } from '../db.ts'
import type { EventHub } from '../events.ts'
import type { ScanDoc } from '../types.ts'

export async function insertScan(db: Db, hub: EventHub, doc: ScanDoc): Promise<void> {
  await db.collection(COLLECTIONS.scans).insertOne({ ...doc })
  hub.emit('scan.created', {
    scan_id: doc.scan_id,
    scan_datetime: doc.scan_datetime,
    quality_verdict: doc.quality_verdict,
    bin_index: doc.bin_index,
    bin_assigned: doc.bin_assigned,
    reason_code: doc.reason_code,
    alerts: doc.alerts,
  })
}

/** Fill in what the controller reported once its acknowledgement arrives. */
export async function recordActuation(
  db: Db,
  hub: EventHub,
  scanId: number,
  ack: { ok: boolean; ms: number | null },
): Promise<void> {
  await db.collection(COLLECTIONS.scans).updateOne(
    { scan_id: scanId },
    {
      $set: {
        'sorting_log.actuation_status': ack.ok ? 'success' : 'failed',
        'sorting_log.latency_ms': ack.ms,
        'sorting_log.logged_at': new Date(),
      },
    },
  )
  hub.emit('scan.updated', { scan_id: scanId })
}
