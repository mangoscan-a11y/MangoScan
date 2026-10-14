import { z } from 'zod'
import type { InferenceResult } from '../types.ts'

const confidence = z.number().min(0).max(1)
const labelled = z.object({ label: z.string().max(64), confidence })

export const resultSchema = z.object({
  models: z.object({
    variety: labelled.nullish(),
    disease: labelled.nullish(),
    bruise: z.object({ is_bruised: z.boolean(), confidence }).nullish(),
    color: labelled.nullish(),
    size: z
      .object({
        label: z.string().max(64).nullish().transform((v) => v ?? undefined),
        grams: z.number().nonnegative().nullish().transform((v) => v ?? undefined),
        confidence: confidence.nullish().transform((v) => v ?? undefined),
      })
      .nullish(),
  }),
  decision: z.object({
    scan_id: z.string().max(64),
    bin_index: z.number().int().min(1).max(8),
    bin_name: z.string().max(40),
    quality_verdict: z.enum(['passed', 'rejected']),
    reason_code: z.string().max(40),
    servo1_action: z.string().max(40),
    servo2_action: z.string().max(40),
    detected_variety: z.string().max(64).nullable(),
    declared_variety: z.string().max(64).nullable(),
    variety_match: z.boolean().nullable(),
    alerts: z.array(z.string().max(40)).max(20),
    decision_trace: z.array(z.object({ step: z.string().max(40), result: z.string().max(80), detail: z.string().max(200) })).max(30),
    engine_version: z.string().max(32),
    config_version: z.string().max(100),
  }),
  resolved_size: z.string().max(32).nullish(),
})

const MAX_RESPONSE_BYTES = 256 * 1024
// A hung service must not make the status page hang with it.
const HEALTH_TIMEOUT_MS = 1500

export interface ClassifyRequest {
  scanId: number
  imagePaths: string[]
  declaredVariety: string | null
}

export class InferenceClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(baseUrl: string, timeoutMs: number) {
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
  }

  async classify(req: ClassifyRequest): Promise<InferenceResult> {
    const body = JSON.stringify({
      scan_id: String(req.scanId),
      image_paths: req.imagePaths,
      declared_variety: req.declaredVariety,
    })
    const text = await this.fetchText('/classify', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error('inference service returned an invalid response (not JSON)')
    }
    const parsed = resultSchema.safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error('inference service returned an invalid response: ' + issue.path.join('.') + ' ' + issue.message)
    }
    return parsed.data as InferenceResult
  }

  async health(): Promise<{ ok: boolean; detail?: string; mode?: 'mock' | 'custom' | 'none' }> {
    try {
      const text = await this.fetchText('/health', { method: 'GET' }, HEALTH_TIMEOUT_MS)
      let mode: string | undefined
      try {
        mode = (JSON.parse(text) as { mode?: string }).mode
      } catch {
        mode = undefined
      }
      return mode === 'mock' || mode === 'custom' || mode === 'none' ? { ok: true, mode } : { ok: true }
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) }
    }
  }

  private async fetchText(path: string, init: RequestInit, timeoutMs: number = this.timeoutMs): Promise<string> {
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('inference service timed out after ' + timeoutMs + ' ms')
      }
      throw new Error('inference service unreachable: ' + (err instanceof Error ? err.message : String(err)))
    }
    if (!res.ok) {
      let detail = ''
      try {
        const body = (await res.json()) as { error?: unknown }
        if (typeof body.error === 'string') detail = ': ' + body.error.slice(0, 300)
      } catch {
        // not JSON, the status alone will do
      }
      throw new Error('inference service returned HTTP ' + res.status + detail)
    }
    const text = await res.text()
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('inference service response too large')
    return text
  }
}

/**
 * What happens when a mango cannot be classified. It is rejected into the diseased/low-confidence
 * bin, the same way Model 5 treats a missing dimension, so an outage never sends unchecked fruit
 * into the sellable bins. Names mirror MyTasks/model5_fusion/config/routing.toml bin 7.
 */
export function fallbackInference(scanId: number, declaredVariety: string | null, reason: string): InferenceResult {
  return {
    models: {},
    decision: {
      scan_id: String(scanId),
      bin_index: 7,
      bin_name: 'REJECT_DISEASED',
      quality_verdict: 'rejected',
      reason_code: reason,
      servo1_action: 'group_diseased',
      servo2_action: 'slot_park',
      detected_variety: null,
      declared_variety: declaredVariety,
      variety_match: null,
      alerts: [reason],
      decision_trace: [{ step: 'fallback', result: 'bin 7', detail: reason }],
      engine_version: 'fallback',
      config_version: 'fallback',
    },
    resolved_size: null,
  }
}
