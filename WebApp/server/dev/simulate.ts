import type { InferenceResult } from '../types.ts'

// A small stand-in for MyTasks/model5_fusion, used only to generate sample data
// for the seed script, the simulator and tests. Real routing lives in Model 5.

export const BINS = [
  { index: 1, name: 'REJECT_DISEASED', verdict: 'rejected', s1: 'group_diseased', s2: 'slot_park' },
  { index: 2, name: 'REJECT_BRUISED', verdict: 'rejected', s1: 'group_bruised', s2: 'slot_park' },
  { index: 3, name: 'GREEN_SMALL', verdict: 'passed', s1: 'group_green', s2: 'slot_small' },
  { index: 4, name: 'YELLOW_SMALL', verdict: 'passed', s1: 'group_yellow', s2: 'slot_small' },
  { index: 5, name: 'GREEN_MEDIUM', verdict: 'passed', s1: 'group_green', s2: 'slot_medium' },
  { index: 6, name: 'YELLOW_MEDIUM', verdict: 'passed', s1: 'group_yellow', s2: 'slot_medium' },
  { index: 7, name: 'GREEN_LARGE', verdict: 'passed', s1: 'group_green', s2: 'slot_large' },
  { index: 8, name: 'YELLOW_LARGE', verdict: 'passed', s1: 'group_yellow', s2: 'slot_large' },
] as const

const VARIETIES = ['Carabao', 'Apple Mango', 'Indian', 'Chupadera', 'Wani', 'Kabayo']
const SIZES = ['Small', 'Medium', 'Large'] as const
const GRAMS = { Small: 150, Medium: 270, Large: 400 } as const

export interface SimOptions {
  variety?: string
  disease?: string
  bruised?: boolean
  color?: 'Green' | 'Yellow'
  size?: (typeof SIZES)[number]
  declared?: string | null
  confidence?: number
}

export function simulateInference(scanId: number, o: SimOptions): InferenceResult {
  const variety = o.variety ?? 'Carabao'
  const disease = o.disease ?? 'Healthy'
  const bruised = o.bruised ?? false
  const color = o.color ?? 'Green'
  const size = o.size ?? 'Medium'
  const declared = o.declared ?? null
  const c = o.confidence ?? 0.9

  let binName: (typeof BINS)[number]['name']
  let reason: string
  if (disease !== 'Healthy') {
    binName = 'REJECT_DISEASED'
    reason = 'DISEASE_DETECTED'
  } else if (bruised) {
    binName = 'REJECT_BRUISED'
    reason = 'BRUISE_DETECTED'
  } else {
    binName = `${color.toUpperCase() as Uppercase<typeof color>}_${size.toUpperCase() as Uppercase<typeof size>}`
    reason = 'ROUTED_BY_COLOR_SIZE'
  }
  const bin = BINS.find((b) => b.name === binName)!
  const mismatch = declared !== null && declared !== variety

  return {
    models: {
      variety: { label: variety, confidence: c },
      disease: { label: disease, confidence: c },
      bruise: { is_bruised: bruised, confidence: c },
      color: { label: color, confidence: c },
      size: { label: size, grams: GRAMS[size], confidence: c },
    },
    decision: {
      scan_id: String(scanId),
      bin_index: bin.index,
      bin_name: bin.name,
      quality_verdict: bin.verdict,
      reason_code: reason,
      servo1_action: bin.s1,
      servo2_action: bin.s2,
      detected_variety: variety,
      declared_variety: declared,
      variety_match: declared === null ? null : !mismatch,
      alerts: mismatch ? ['VARIETY_MISMATCH'] : [],
      decision_trace: [{ step: 'simulated', result: 'bin ' + bin.index, detail: bin.name }],
      engine_version: 'simulator',
      config_version: 'simulator',
    },
    resolved_size: size,
  }
}

/** Plausible random fruit: mostly healthy, mostly the declared variety. */
export function randomOptions(rng: () => number, declared: string | null = null): SimOptions {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]
  const r = rng()
  return {
    variety: declared && rng() < 0.9 ? declared : pick(VARIETIES),
    disease: r < 0.8 ? 'Healthy' : r < 0.92 ? 'Anthracnose' : 'Mango Scab',
    bruised: rng() < 0.15,
    color: rng() < 0.5 ? 'Green' : 'Yellow',
    size: pick(SIZES),
    declared,
    confidence: 0.7 + rng() * 0.29,
  }
}
