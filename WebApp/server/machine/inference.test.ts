// @vitest-environment node
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { InferenceClient, fallbackInference } from './inference.ts'

const good = {
  models: {
    variety: { label: 'Carabao', confidence: 0.9 },
    disease: { label: 'Healthy', confidence: 0.9 },
    bruise: { is_bruised: false, confidence: 0.9 },
    color: { label: 'Green', confidence: 0.9 },
    size: { label: 'Medium', grams: 250, confidence: 0.9 },
  },
  decision: {
    scan_id: '5',
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
    config_version: 'routing.toml@sha256:x',
  },
  resolved_size: 'Medium',
}

let server: http.Server | null = null
let lastBody: unknown = null

async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => handler(req, res, body))
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
  return 'http://127.0.0.1:' + (server.address() as AddressInfo).port
}

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = null
})

const req = { scanId: 5, imagePaths: ['/tmp/a.jpg'], declaredVariety: 'Carabao' }

describe('InferenceClient', () => {
  it('posts the scan and returns the validated result', async () => {
    const url = await serve((_q, res, body) => {
      lastBody = JSON.parse(body)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(good))
    })
    const result = await new InferenceClient(url, 1000).classify(req)
    expect(result.decision.bin_name).toBe('GREEN_MEDIUM')
    expect(lastBody).toEqual({ scan_id: '5', image_paths: ['/tmp/a.jpg'], declared_variety: 'Carabao' })
  })

  it('throws on a server error', async () => {
    const url = await serve((_q, res) => {
      res.statusCode = 500
      res.end('boom')
    })
    await expect(new InferenceClient(url, 1000).classify(req)).rejects.toThrow(/500/)
  })

  it('passes the service explanation of a rejection into the error, so the cause is visible in the log', async () => {
    const url = await serve((_q, res) => {
      res.statusCode = 422
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: "model output rejected: color: unknown label 'Overripe'" }))
    })
    await expect(new InferenceClient(url, 1000).classify(req)).rejects.toThrow(/422.*Overripe/)
  })

  it('throws when the service answers too slowly', async () => {
    const url = await serve(() => {})
    await expect(new InferenceClient(url, 100).classify(req)).rejects.toThrow(/timed out/i)
  })

  it('throws when nothing is listening', async () => {
    await expect(new InferenceClient('http://127.0.0.1:1', 500).classify(req)).rejects.toThrow()
  })

  it('refuses a response that is not shaped like a decision', async () => {
    const url = await serve((_q, res) => {
      res.end(JSON.stringify({ ...good, decision: { ...good.decision, bin_index: 99 } }))
    })
    await expect(new InferenceClient(url, 1000).classify(req)).rejects.toThrow(/invalid/i)
  })

  it('reports health', async () => {
    const url = await serve((_q, res) => res.end(JSON.stringify({ ok: true, mode: 'mock' })))
    expect(await new InferenceClient(url, 500).health()).toEqual({ ok: true, mode: 'mock' })
    expect((await new InferenceClient('http://127.0.0.1:1', 300).health()).ok).toBe(false)
  })
})

describe('fallbackInference', () => {
  it('rejects into bin 7 with the reason recorded, never silently passing a mango', () => {
    const r = fallbackInference(9, 'Carabao', 'INFERENCE_UNAVAILABLE')
    expect(r.decision).toMatchObject({
      scan_id: '9',
      bin_index: 7,
      bin_name: 'REJECT_DISEASED',
      quality_verdict: 'rejected',
      reason_code: 'INFERENCE_UNAVAILABLE',
      declared_variety: 'Carabao',
      variety_match: null,
    })
    expect(r.decision.alerts).toEqual(['INFERENCE_UNAVAILABLE'])
    expect(r.models).toEqual({})
  })
})
