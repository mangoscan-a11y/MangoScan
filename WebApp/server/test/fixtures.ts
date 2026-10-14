import { buildScanDocument } from '../machine/scan-builder.ts'
import { simulateInference, type SimOptions } from '../dev/simulate.ts'
import type { RefData, ScanDoc } from '../types.ts'

export function fixtureScan(refs: RefData, o: SimOptions & { id: number; at: Date; processing?: number }): ScanDoc {
  return buildScanDocument({
    scanId: o.id,
    now: o.at,
    processingSeconds: o.processing ?? 1.5,
    inference: simulateInference(o.id, o),
    refs,
    images: [],
    fullBins: new Set<number>(),
  })
}
