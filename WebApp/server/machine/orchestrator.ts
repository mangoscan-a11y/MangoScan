import fs from 'node:fs/promises'
import path from 'node:path'
import type { Db } from 'mongodb'
import { nextScanId } from '../db.ts'
import type { EventHub } from '../events.ts'
import type { Device, DeviceManager } from '../serial/device-manager.ts'
import type { InferenceResult, ScanDoc } from '../types.ts'
import type { BinManager } from './bin-manager.ts'
import { fallbackInference, type InferenceClient } from './inference.ts'
import type { RefCache } from './ref-cache.ts'
import { buildScanDocument } from './scan-builder.ts'
import { insertScan, recordActuation } from './scan-store.ts'
import { getDeclaredVariety } from './settings.ts'

/** Running plus waiting scans allowed before new triggers are turned away. */
const MAX_PENDING = 6

export class ScanError extends Error {
  readonly code: 'NO_CAMERA' | 'BUSY'

  constructor(code: 'NO_CAMERA' | 'BUSY', message: string) {
    super(message)
    this.name = 'ScanError'
    this.code = code
  }
}

export interface OrchestratorDeps {
  db: Db
  refs: RefCache
  bins: BinManager
  hub: EventHub
  devices: DeviceManager
  inference: InferenceClient
  storageDir: string
  log: (msg: string) => void
  captureTimeoutMs?: number
  sortTimeoutMs?: number
}

interface Captured {
  angle: number
  data: Buffer
}

interface SavedImage {
  angle: number
  path: string
  abs: string
  captured_at: Date
}

function planAngles(cam: Device): number[] {
  const angles = cam.info.angles.filter((a) => Number.isInteger(a) && a >= 1 && a <= 9)
  return angles.length > 0 ? angles : [1]
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Runs one mango through capture, classification, sorting and storage. */
export class Orchestrator {
  private readonly d: OrchestratorDeps
  private readonly captureTimeoutMs: number
  private readonly sortTimeoutMs: number
  private tail: Promise<unknown> = Promise.resolve()
  private pending = 0
  private readonly actuations = new Set<Promise<void>>()

  constructor(deps: OrchestratorDeps) {
    this.d = deps
    this.captureTimeoutMs = deps.captureTimeoutMs ?? 2000
    this.sortTimeoutMs = deps.sortTimeoutMs ?? 1500
  }

  /** Queue a scan. Scans run strictly one at a time because there is one conveyor. */
  scan(trigger: 'manual' | 'device'): Promise<ScanDoc> {
    return this.exclusive(() => this.runOne(trigger))
  }

  /** Run a short hardware job in the scan queue, so it never overlaps a scan on the camera or the servos. */
  exclusive<T>(job: () => Promise<T>): Promise<T> {
    if (this.pending >= MAX_PENDING) {
      return Promise.reject(new ScanError('BUSY', 'The machine is still working through earlier scans'))
    }
    this.pending++
    const run = this.tail.then(job)
    this.tail = run.catch(() => {})
    return run.finally(() => {
      this.pending--
    })
  }

  /** Resolves when every servo acknowledgement still in flight has been recorded. */
  async settled(): Promise<void> {
    await Promise.all([...this.actuations])
  }

  private async runOne(trigger: string): Promise<ScanDoc> {
    const { db, devices, log } = this.d
    const cameras = devices.cameras()
    if (cameras.length === 0) throw new ScanError('NO_CAMERA', 'No camera is connected')

    const t0 = performance.now()
    const scanId = await nextScanId(db)
    const declared = await getDeclaredVariety(db)
    log('scan ' + scanId + ' started (' + trigger + ')')

    const expected = new Set(cameras.flatMap((c) => planAngles(c))).size
    const captured = await this.captureAll(cameras, scanId)
    const images = await this.saveImages(scanId, captured)

    let inference: InferenceResult
    if (images.length === 0) {
      inference = fallbackInference(scanId, declared, 'CAPTURE_FAILED')
    } else {
      try {
        inference = await this.d.inference.classify({
          scanId,
          imagePaths: images.map((i) => i.abs),
          declaredVariety: declared,
        })
      } catch (err) {
        log('scan ' + scanId + ': ' + errText(err))
        inference = fallbackInference(scanId, declared, 'INFERENCE_UNAVAILABLE')
      }
    }
    if (images.length > 0 && images.length < expected) inference.decision.alerts.push('PARTIAL_CAPTURE')

    // The servos get their command before anything touches the database.
    const controller = devices.controller()
    if (controller) this.dispatchSort(controller, scanId, inference)
    else inference.decision.alerts.push('NO_CONTROLLER')

    const doc = buildScanDocument({
      scanId,
      now: new Date(),
      processingSeconds: (performance.now() - t0) / 1000,
      inference,
      refs: this.d.refs.get(),
      images: images.map((i) => ({ angle: i.angle, path: i.path, captured_at: i.captured_at })),
      fullBins: this.d.bins.fullSet(),
    })
    if (!controller) doc.sorting_log.actuation_status = 'failed'

    await insertScan(db, this.d.hub, doc)
    log('scan ' + scanId + ' done: ' + doc.bin_assigned + ' (' + doc.processing_time + ' s)')
    return doc
  }

  private dispatchSort(controller: Device, scanId: number, inference: InferenceResult): void {
    const { decision } = inference
    const sentAt = performance.now()
    const job: Promise<void> = controller
      .sort({ scanId, bin: decision.bin_index, s1: decision.servo1_action, s2: decision.servo2_action }, this.sortTimeoutMs)
      .then((ack) => ({ ok: ack.ok, ms: ack.ms ?? Math.round(performance.now() - sentAt) }))
      .catch((err) => {
        this.d.log('scan ' + scanId + ': no servo acknowledgement (' + errText(err) + ')')
        return { ok: false, ms: null as number | null }
      })
      .then(async (ack) => {
        // The ack can beat the database insert, so wait for the document to exist.
        for (let i = 0; i < 20; i++) {
          if (await this.d.db.collection('scans').countDocuments({ scan_id: scanId }, { limit: 1 })) break
          await new Promise((r) => setTimeout(r, 25))
        }
        await recordActuation(this.d.db, this.d.hub, scanId, ack)
      })
      .catch((err) => this.d.log('could not record actuation: ' + errText(err)))
      .finally(() => {
        this.actuations.delete(job)
      })
    this.actuations.add(job)
  }

  private async captureAll(cameras: Device[], scanId: number): Promise<Captured[]> {
    const perCamera = await Promise.all(
      cameras.map(async (cam) => {
        const got: Captured[] = []
        let deadAngles = 0
        for (const angle of planAngles(cam)) {
          const data = await this.captureOne(cam, scanId, angle)
          if (data) got.push({ angle, data })
          else if (++deadAngles >= 2) break
        }
        return got
      }),
    )
    const byAngle = new Map<number, Captured>()
    for (const c of perCamera.flat()) {
      if (!byAngle.has(c.angle)) byAngle.set(c.angle, c)
    }
    return [...byAngle.values()].sort((a, b) => a.angle - b.angle)
  }

  private async captureOne(cam: Device, scanId: number, angle: number): Promise<Buffer | null> {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await cam.capture(scanId, angle, this.captureTimeoutMs)
      } catch (err) {
        this.d.log('scan ' + scanId + ' angle ' + angle + ' attempt ' + attempt + ': ' + errText(err))
      }
    }
    return null
  }

  private async saveImages(scanId: number, captured: Captured[]): Promise<SavedImage[]> {
    if (captured.length === 0) return []
    const rel = path.posix.join('scan-images', String(scanId))
    const dir = path.join(this.d.storageDir, 'scan-images', String(scanId))
    await fs.mkdir(dir, { recursive: true })
    const now = new Date()
    return Promise.all(
      captured.map(async (c) => {
        // File names come from validated integers, never from device text.
        const name = 'angle-' + c.angle + '.jpg'
        const abs = path.join(dir, name)
        await fs.writeFile(abs, c.data)
        return { angle: c.angle, path: path.posix.join(rel, name), abs, captured_at: now }
      }),
    )
  }
}
