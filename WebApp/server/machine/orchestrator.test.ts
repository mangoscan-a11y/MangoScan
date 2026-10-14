// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mongoAvailable } from '../test/mongo.ts'
import { createHarness, type Harness } from '../test/harness.ts'
import { setDeclaredVariety } from './settings.ts'
import { ScanError } from './orchestrator.ts'

const hasMongo = await mongoAvailable()

describe.skipIf(!hasMongo)('Orchestrator', () => {
  let h: Harness
  afterEach(async () => {
    await h.close()
  })

  describe('with a camera and a controller', () => {
    beforeEach(async () => {
      h = await createHarness()
    })

    it('captures, classifies, sorts, stores and announces one mango', async () => {
      const doc = await h.orchestrator.scan('manual')

      expect(doc).toMatchObject({ quality_verdict: 'passed', bin_assigned: 'GREEN_MEDIUM', reason_code: 'ROUTED_BY_COLOR_SIZE' })
      expect(doc.images).toHaveLength(5)
      for (const img of doc.images) {
        expect(fs.existsSync(path.join(h.storageDir, img.image_path))).toBe(true)
      }
      expect(h.ctrl.sorts).toEqual([{ scan_id: doc.scan_id, bin: 5, s1: 'group_green', s2: 'slot_medium' }])

      const stored = await h.t.db.collection('scans').findOne({ scan_id: doc.scan_id })
      expect(stored?.variety).toEqual({ variety_id: 1, variety_name: 'Carabao' })
      expect(h.events.some((e) => e.event === 'scan.created')).toBe(true)
    })

    it('makes a hardware job wait its turn behind a scan', async () => {
      const scan = h.orchestrator.scan('manual')
      const sortsSeenByJob = h.orchestrator.exclusive(async () => h.ctrl.sorts.length)
      await scan
      expect(await sortsSeenByJob).toBe(1)
    })

    it('turns hardware jobs away when the queue is full, like scans', async () => {
      const release: (() => void)[] = []
      const held = Array.from({ length: 6 }, () => h.orchestrator.exclusive(() => new Promise<void>((r) => release.push(r))))
      const err = await h.orchestrator.exclusive(async () => 1).catch((e) => e)
      expect(err).toBeInstanceOf(ScanError)
      expect(err.code).toBe('BUSY')
      await vi.waitFor(() => expect(release.length).toBe(1))
      for (let i = 0; i < held.length; i++) {
        await vi.waitFor(() => expect(release.length).toBeGreaterThan(i))
        release[i]()
      }
      await Promise.all(held)
    })

    it('records the real servo acknowledgement once it arrives', async () => {
      const doc = await h.orchestrator.scan('manual')
      await h.orchestrator.settled()
      const stored = await h.t.db.collection('scans').findOne({ scan_id: doc.scan_id })
      expect(stored?.sorting_log).toMatchObject({ actuation_status: 'success', latency_ms: 3 })
    })

    it('commands the servos before it writes to the database', async () => {
      const order: string[] = []
      h.ctrl.onSort = () => order.push('sort')
      h.hub.subscribe({
        write(chunk: string) {
          if (chunk.startsWith('event: scan.created')) order.push('stored')
          return true
        },
        onClose() {},
      })
      await h.orchestrator.scan('manual')
      expect(order).toEqual(['sort', 'stored'])
    })

    it('tells the models which variety the operator declared', async () => {
      await setDeclaredVariety(h.t.db, 'Wani')
      await h.orchestrator.scan('manual')
      expect(h.inferenceBodies.at(-1)).toMatchObject({ declared_variety: 'Wani' })
      const paths = (h.inferenceBodies.at(-1)?.image_paths ?? []) as string[]
      expect(paths).toHaveLength(5)
      expect(paths.every((p) => path.isAbsolute(p) && fs.existsSync(p))).toBe(true)
    })

    it('flags a mango routed into a bin that is already full', async () => {
      await h.bins.report(5, true)
      const doc = await h.orchestrator.scan('manual')
      expect(doc.alerts).toContain('BIN_FULL')
    })

    it('retries a frame the camera dropped', async () => {
      h.cam.failNextCapture = true
      const doc = await h.orchestrator.scan('manual')
      expect(doc.images).toHaveLength(5)
      expect(doc.alerts).not.toContain('PARTIAL_CAPTURE')
    })

    it('rejects the mango when no frame can be captured at all', async () => {
      h.cam.failAllCaptures = true
      const doc = await h.orchestrator.scan('manual')
      expect(doc).toMatchObject({ quality_verdict: 'rejected', bin_index: 1, reason_code: 'CAPTURE_FAILED' })
      expect(doc.images).toHaveLength(0)
      expect(h.ctrl.sorts.at(-1)?.bin).toBe(1)
      expect(h.inferenceBodies).toHaveLength(0)
    })

    it('rejects into bin 1 instead of passing fruit when the inference service is down', async () => {
      h.setInference(() => null)
      const doc = await h.orchestrator.scan('manual')
      expect(doc).toMatchObject({ quality_verdict: 'rejected', bin_index: 1, reason_code: 'INFERENCE_UNAVAILABLE' })
      expect(doc.images).toHaveLength(5)
      expect(h.ctrl.sorts.at(-1)?.bin).toBe(1)
    })

    it('processes simultaneous triggers one at a time, in order', async () => {
      const docs = await Promise.all([h.orchestrator.scan('device'), h.orchestrator.scan('device'), h.orchestrator.scan('manual')])
      const ids = docs.map((d) => d.scan_id)
      expect(ids).toEqual([...ids].sort((a, b) => a - b))
      expect(new Set(ids).size).toBe(3)
      expect(h.ctrl.sorts.map((s) => s.scan_id)).toEqual(ids)
    })

    it('refuses new work when too many scans are already waiting', async () => {
      const results = await Promise.allSettled(Array.from({ length: 9 }, () => h.orchestrator.scan('device')))
      const busy = results.filter((r) => r.status === 'rejected' && (r.reason as ScanError).code === 'BUSY')
      expect(busy.length).toBeGreaterThan(0)
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(6)
    })
  })

  describe('with missing hardware', () => {
    it('does not invent a scan when no camera is connected', async () => {
      h = await createHarness({ camera: false })
      await expect(h.orchestrator.scan('manual')).rejects.toMatchObject({ code: 'NO_CAMERA' })
      expect(await h.t.db.collection('scans').countDocuments()).toBe(0)
    })

    it('still records the scan when the controller is missing, marking the actuation failed', async () => {
      h = await createHarness({ controller: false })
      const doc = await h.orchestrator.scan('manual')
      expect(doc.alerts).toContain('NO_CONTROLLER')
      const stored = await h.t.db.collection('scans').findOne({ scan_id: doc.scan_id })
      expect(stored?.sorting_log.actuation_status).toBe('failed')
    })

    it('marks the actuation failed when the controller never acknowledges', async () => {
      h = await createHarness()
      h.ctrl.write = () => {}
      const doc = await h.orchestrator.scan('manual')
      await h.orchestrator.settled()
      const stored = await h.t.db.collection('scans').findOne({ scan_id: doc.scan_id })
      expect(stored?.sorting_log.actuation_status).toBe('failed')
    })
  })

})
