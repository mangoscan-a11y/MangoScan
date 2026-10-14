// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildScanDocument, type BuildScanInput } from './scan-builder.ts'
import type { InferenceResult } from '../types.ts'

const refs: BuildScanInput['refs'] = {
  varieties: [
    { variety_id: 1, variety_name: 'Carabao', description: null, market_price: 120 },
    { variety_id: 4, variety_name: 'Chupadera', description: null, market_price: 60 },
  ],
  diseases: [
    { disease_id: 1, disease_name: 'Healthy', description: null, severity_level: 'none' },
    { disease_id: 2, disease_name: 'Anthracnose', description: null, severity_level: 'high' },
  ],
  ripeness: [
    { ripeness_id: 1, ripeness_name: 'Green', description: null, sort_order: 1 },
    { ripeness_id: 2, ripeness_name: 'Yellow', description: null, sort_order: 2 },
  ],
  sizes: [
    { size_id: 1, size_name: 'Small', description: null, min_grams: 0, max_grams: 200, sort_order: 1 },
    { size_id: 2, size_name: 'Medium', description: null, min_grams: 200, max_grams: 350, sort_order: 2 },
  ],
}

function inference(overrides: Partial<InferenceResult> = {}): InferenceResult {
  return {
    models: {
      variety: { label: 'Carabao', confidence: 0.94 },
      disease: { label: 'Healthy', confidence: 0.9 },
      bruise: { is_bruised: false, confidence: 0.8 },
      color: { label: 'Green', confidence: 0.7 },
      size: { label: 'Medium', confidence: 0.6 },
    },
    decision: {
      scan_id: '42',
      bin_index: 2,
      bin_name: 'GREEN_MEDIUM',
      quality_verdict: 'passed',
      reason_code: 'ROUTED_BY_COLOR_SIZE',
      servo1_action: 'group_green',
      servo2_action: 'slot_medium',
      detected_variety: 'Carabao',
      declared_variety: 'Carabao',
      variety_match: true,
      alerts: [],
      decision_trace: [{ step: 'grade', result: 'bin 2', detail: 'Green x Medium' }],
      engine_version: '1.0.0',
      config_version: 'routing.toml@sha256:abc',
    },
    ...overrides,
  }
}

const base = (over: Partial<BuildScanInput> = {}): BuildScanInput => ({
  scanId: 42,
  now: new Date('2026-10-15T02:00:00Z'),
  processingSeconds: 1.2349,
  inference: inference(),
  refs,
  images: [
    { angle: 1, path: 'scan-images/42/angle-1.jpg', captured_at: new Date('2026-10-15T02:00:00Z') },
    { angle: 2, path: 'scan-images/42/angle-2.jpg', captured_at: new Date('2026-10-15T02:00:01Z') },
  ],
  fullBins: new Set<number>(),
  ...over,
})

describe('buildScanDocument', () => {
  it('resolves every label to its reference row and copies the routing decision', () => {
    const doc = buildScanDocument(base())
    expect(doc).toMatchObject({
      scan_id: 42,
      quality_verdict: 'passed',
      bin_index: 2,
      bin_assigned: 'GREEN_MEDIUM',
      reason_code: 'ROUTED_BY_COLOR_SIZE',
      declared_variety: 'Carabao',
      variety_match: true,
      is_bruised: false,
      bruise_confidence: 80,
      variety: { variety_id: 1, variety_name: 'Carabao' },
      disease: { disease_id: 1, disease_name: 'Healthy', severity_level: 'none' },
      ripeness: { ripeness_id: 1, ripeness_name: 'Green' },
      size: { size_id: 2, size_name: 'Medium' },
      engine_version: '1.0.0',
    })
    expect(doc.processing_time).toBe(1.23)
    expect(doc.scan_datetime).toEqual(new Date('2026-10-15T02:00:00Z'))
  })

  it('averages the routing confidences as a percentage', () => {
    expect(buildScanDocument(base()).confidence_score).toBe(75)
  })

  it('leaves size confidence out of the average when the size came from grams', () => {
    const inf = inference()
    inf.models.size = { grams: 230, confidence: 0 }
    inf.resolved_size = 'Medium'
    const doc = buildScanDocument(base({ inference: inf }))
    expect(doc.confidence_score).toBe(80)
    expect(doc.size).toEqual({ size_id: 2, size_name: 'Medium' })
  })

  it('prefers the size Model 5 resolved over the raw model label', () => {
    const inf = inference()
    inf.models.size = { label: 'Small', grams: 260, confidence: 0.9 }
    inf.resolved_size = 'Medium'
    expect(buildScanDocument(base({ inference: inf })).size?.size_name).toBe('Medium')
  })

  it('stores unknown labels as null instead of throwing', () => {
    const inf = inference()
    inf.models.variety = { label: 'Mystery', confidence: 0.9 }
    const doc = buildScanDocument(base({ inference: inf }))
    expect(doc.variety).toBeNull()
    expect(doc.detections.find((d) => d.class_type === 'variety')?.detected_class).toBe('Mystery')
  })

  it('writes one detection per available dimension, with confidence as a percentage', () => {
    const doc = buildScanDocument(base())
    expect(doc.detections.map((d) => [d.class_type, d.detected_class, d.confidence])).toEqual([
      ['variety', 'Carabao', 94],
      ['disease', 'Healthy', 90],
      ['bruise', 'Not Bruised', 80],
      ['color', 'Green', 70],
      ['size', 'Medium', 60],
    ])
    expect(new Set(doc.detections.map((d) => d.result_id)).size).toBe(5)
  })

  it('skips dimensions the models did not produce', () => {
    const inf = inference()
    inf.models = { disease: { label: 'Healthy', confidence: 0.9 } }
    inf.decision.alerts = ['LOW_CONFIDENCE_BRUISE']
    const doc = buildScanDocument(base({ inference: inf }))
    expect(doc.detections).toHaveLength(1)
    expect(doc.is_bruised).toBeNull()
    expect(doc.bruise_confidence).toBeNull()
    expect(doc.ripeness).toBeNull()
    expect(doc.confidence_score).toBe(90)
  })

  it('has no confidence score when nothing was classified', () => {
    const inf = inference()
    inf.models = {}
    expect(buildScanDocument(base({ inference: inf })).confidence_score).toBeNull()
  })

  it('records a bruised fruit', () => {
    const inf = inference()
    inf.models.bruise = { is_bruised: true, confidence: 0.91 }
    const doc = buildScanDocument(base({ inference: inf }))
    expect(doc.is_bruised).toBe(true)
    expect(doc.detections.find((d) => d.class_type === 'bruise')?.detected_class).toBe('Bruised')
  })

  it('adds BIN_FULL after the decision alerts when the target bin is already full', () => {
    const inf = inference()
    inf.decision.alerts = ['VARIETY_MISMATCH']
    const doc = buildScanDocument(base({ inference: inf, fullBins: new Set([2]) }))
    expect(doc.alerts).toEqual(['VARIETY_MISMATCH', 'BIN_FULL'])
    expect(buildScanDocument(base({ fullBins: new Set([5]) })).alerts).toEqual([])
  })

  it('embeds images with deterministic ids and a pending sorting log', () => {
    const doc = buildScanDocument(base())
    expect(doc.images.map((i) => [i.image_id, i.angle_sequence, i.image_path])).toEqual([
      [421, 1, 'scan-images/42/angle-1.jpg'],
      [422, 2, 'scan-images/42/angle-2.jpg'],
    ])
    expect(doc.sorting_log).toMatchObject({
      scan_id: 42,
      servo1_action: 'group_green',
      servo2_action: 'slot_medium',
      gate_target: 'GREEN_MEDIUM',
      actuation_status: 'pending',
      latency_ms: null,
    })
  })
})
