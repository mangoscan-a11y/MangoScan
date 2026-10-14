import type { DetectionDoc, InferenceResult, RefData, ScanDoc, ScanImageDoc } from '../types.ts'

export interface BuildScanInput {
  scanId: number
  now: Date
  processingSeconds: number
  inference: InferenceResult
  refs: RefData
  images: { angle: number; path: string; captured_at: Date }[]
  /** Bins the controller currently reports as full. */
  fullBins: ReadonlySet<number>
}

/** Models speak in 0..1; the database and the dashboard use percentages. */
const pct = (x: number) => Math.round(x * 10000) / 100
const round2 = (x: number) => Math.round(x * 100) / 100

const DETECTION_SLOT = { variety: 1, disease: 2, bruise: 3, color: 4, size: 5 } as const

export function buildScanDocument(input: BuildScanInput): ScanDoc {
  const { scanId, now, inference, refs, fullBins } = input
  const { models, decision } = inference

  const variety = refs.varieties.find((v) => v.variety_name === models.variety?.label)
  const disease = refs.diseases.find((d) => d.disease_name === models.disease?.label)
  const ripeness = refs.ripeness.find((r) => r.ripeness_name === models.color?.label)
  const sizeLabel = inference.resolved_size ?? models.size?.label ?? null
  const size = sizeLabel ? refs.sizes.find((s) => s.size_name === sizeLabel) : undefined

  // Routing confidences only. Variety is a QC check, and a load cell has no
  // softmax, so a grams-based size reading does not contribute.
  const confidences: number[] = []
  if (models.disease) confidences.push(models.disease.confidence)
  if (models.bruise) confidences.push(models.bruise.confidence)
  if (models.color) confidences.push(models.color.confidence)
  if (models.size && models.size.grams === undefined && models.size.confidence !== undefined) {
    confidences.push(models.size.confidence)
  }
  const confidenceScore =
    confidences.length > 0 ? pct(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null

  const detections: DetectionDoc[] = []
  const detect = (
    dim: keyof typeof DETECTION_SLOT,
    detectedClass: string | null | undefined,
    confidence: number | undefined,
  ) => {
    if (!detectedClass) return
    detections.push({
      result_id: scanId * 10 + DETECTION_SLOT[dim],
      scan_id: scanId,
      image_id: null,
      detected_class: detectedClass,
      class_type: dim,
      confidence: pct(confidence ?? 0),
      bbox_x: null,
      bbox_y: null,
      bbox_w: null,
      bbox_h: null,
    })
  }
  detect('variety', models.variety?.label, models.variety?.confidence)
  detect('disease', models.disease?.label, models.disease?.confidence)
  if (models.bruise) {
    detect('bruise', models.bruise.is_bruised ? 'Bruised' : 'Not Bruised', models.bruise.confidence)
  }
  detect('color', models.color?.label, models.color?.confidence)
  detect('size', sizeLabel, models.size?.confidence)

  const images: ScanImageDoc[] = input.images.map((img) => ({
    image_id: scanId * 10 + img.angle,
    scan_id: scanId,
    image_path: img.path,
    angle_sequence: img.angle,
    captured_at: img.captured_at,
  }))

  const alerts = [...decision.alerts]
  if (fullBins.has(decision.bin_index)) alerts.push('BIN_FULL')

  return {
    scan_id: scanId,
    scan_datetime: now,
    quality_verdict: decision.quality_verdict,
    confidence_score: confidenceScore,
    processing_time: round2(input.processingSeconds),
    bin_index: decision.bin_index,
    bin_assigned: decision.bin_name,
    reason_code: decision.reason_code,
    alerts,
    declared_variety: decision.declared_variety,
    variety_match: decision.variety_match,
    is_bruised: models.bruise ? models.bruise.is_bruised : null,
    bruise_confidence: models.bruise ? pct(models.bruise.confidence) : null,
    variety: variety ? { variety_id: variety.variety_id, variety_name: variety.variety_name } : null,
    disease: disease
      ? { disease_id: disease.disease_id, disease_name: disease.disease_name, severity_level: disease.severity_level }
      : null,
    ripeness: ripeness ? { ripeness_id: ripeness.ripeness_id, ripeness_name: ripeness.ripeness_name } : null,
    size: size ? { size_id: size.size_id, size_name: size.size_name } : null,
    images,
    detections,
    sorting_log: {
      log_id: scanId,
      scan_id: scanId,
      servo1_action: decision.servo1_action,
      servo2_action: decision.servo2_action,
      gate_target: decision.bin_name,
      actuation_status: 'pending',
      latency_ms: null,
      logged_at: now,
    },
    decision_trace: decision.decision_trace,
    engine_version: decision.engine_version,
    config_version: decision.config_version,
  }
}
