import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { ensureIndexes, seedReference } from '../db.ts'
import { EventHub } from '../events.ts'
import { BinManager } from '../machine/bin-manager.ts'
import { InferenceClient } from '../machine/inference.ts'
import { Orchestrator } from '../machine/orchestrator.ts'
import { RefCache } from '../machine/ref-cache.ts'
import { wireDevices } from '../machine/wiring.ts'
import { DeviceManager } from '../serial/device-manager.ts'
import { MockDevice, MockPortSource } from '../serial/mock-device.ts'
import type { InferenceResult } from '../types.ts'
import { createTestDb, type TestDb } from './mongo.ts'
import { waitFor } from './helpers.ts'

export function greenMedium(scanId: string, declared: string | null): InferenceResult {
  return {
    models: {
      variety: { label: 'Carabao', confidence: 0.95 },
      disease: { label: 'Healthy', confidence: 0.95 },
      bruise: { is_bruised: false, confidence: 0.9 },
      color: { label: 'Green', confidence: 0.9 },
      size: { label: 'Medium', grams: 250, confidence: 0.9 },
    },
    decision: {
      scan_id: scanId,
      bin_index: 2,
      bin_name: 'GREEN_MEDIUM',
      quality_verdict: 'passed',
      reason_code: 'ROUTED_BY_COLOR_SIZE',
      servo1_action: 'group_green',
      servo2_action: 'slot_medium',
      detected_variety: 'Carabao',
      declared_variety: declared,
      variety_match: declared === null ? null : declared === 'Carabao',
      alerts: [],
      decision_trace: [{ step: 'grade', result: 'bin 2', detail: 'Green x Medium' }],
      engine_version: '1.0.0',
      config_version: 'routing.toml@sha256:test',
    },
    resolved_size: 'Medium',
  }
}

export interface Harness {
  t: TestDb
  hub: EventHub
  events: { event: string; data: unknown }[]
  refs: RefCache
  bins: BinManager
  source: MockPortSource
  devices: DeviceManager
  ctrl: MockDevice
  cam: MockDevice
  orchestrator: Orchestrator
  storageDir: string
  inferenceBodies: Record<string, unknown>[]
  logs: string[]
  setInference(fn: ((body: Record<string, unknown>) => InferenceResult | null) | null): void
  close(): Promise<void>
}

export async function createHarness(opts: { controller?: boolean; camera?: boolean } = {}): Promise<Harness> {
  const t = await createTestDb()
  await ensureIndexes(t.db)
  await seedReference(t.db)

  const hub = new EventHub()
  const events: { event: string; data: unknown }[] = []
  hub.subscribe({
    write(chunk: string) {
      const m = /^event: (.+)\ndata: (.+)\n\n$/.exec(chunk)
      if (m) events.push({ event: m[1], data: JSON.parse(m[2]) })
      return true
    },
    onClose() {},
  })

  const refs = new RefCache(t.db)
  await refs.load()
  const bins = new BinManager(t.db, hub)
  await bins.load()

  const ctrl = new MockDevice({ id: 'ctrl-1', caps: ['servo', 'bins', 'mango'], ackMs: 3 })
  const cam = new MockDevice({ id: 'cam-1', caps: ['camera'], angles: [1, 2, 3, 4, 5] })
  const source = new MockPortSource()
  if (opts.controller !== false) source.plug('CTRL', () => ctrl)
  if (opts.camera !== false) source.plug('CAM', () => cam)
  const devices = new DeviceManager(source, { pollMs: 20, helloTimeoutMs: 500, helloRetryMs: 50, stallMs: 150, log: () => {} })

  const logs: string[] = []
  const inferenceBodies: Record<string, unknown>[] = []
  let handler: ((body: Record<string, unknown>) => InferenceResult | null) | null = null
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      inferenceBodies.push(body)
      const result = handler ? handler(body) : greenMedium(String(body.scan_id), (body.declared_variety as string | null) ?? null)
      if (!result) {
        res.statusCode = 500
        res.end('down')
        return
      }
      res.end(JSON.stringify(result))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port

  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mangoscan-test-'))
  const orchestrator = new Orchestrator({
    db: t.db,
    refs,
    bins,
    hub,
    devices,
    inference: new InferenceClient(url, 800),
    storageDir,
    log: (m) => logs.push(m),
    captureTimeoutMs: 300,
    sortTimeoutMs: 500,
  })

  wireDevices({ devices, bins, hub, db: t.db, orchestrator, log: (m) => logs.push(m) })
  devices.start()
  if (opts.controller !== false) await waitFor(() => devices.controller(), 2000, 'controller')
  if (opts.camera !== false) await waitFor(() => devices.cameras().length > 0, 2000, 'camera')

  return {
    logs,
    t, hub, events, refs, bins, source, devices, ctrl, cam, orchestrator, storageDir, inferenceBodies,
    setInference(fn) {
      handler = fn
    },
    async close() {
      await devices.stop()
      await new Promise((r) => server.close(r))
      fs.rmSync(storageDir, { recursive: true, force: true })
      await t.drop()
    },
  }
}
