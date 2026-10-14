// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceManager } from '../serial/device-manager.ts'
import { isJpeg } from '../serial/jpeg.ts'
import { MockDevice, MockPortSource } from '../serial/mock-device.ts'
import { sleep, waitFor } from '../test/helpers.ts'
import { CheckError, HardwareCheck } from './hardware-check.ts'

const direct = { exclusive: <T>(job: () => Promise<T>) => job() }

describe('HardwareCheck', () => {
  let source: MockPortSource
  let manager: DeviceManager
  let ctrl: MockDevice
  let cam: MockDevice
  let check: HardwareCheck

  async function connect(opts: { controller?: boolean; camera?: boolean } = {}) {
    if (opts.controller !== false) source.plug('CTRL', () => ctrl)
    if (opts.camera !== false) source.plug('CAM', () => cam)
    manager.start()
    if (opts.controller !== false) await waitFor(() => manager.controller(), 2000, 'controller')
    if (opts.camera !== false) await waitFor(() => manager.cameras().length > 0, 2000, 'camera')
  }

  beforeEach(() => {
    source = new MockPortSource()
    manager = new DeviceManager(source, { pollMs: 20, helloTimeoutMs: 400, helloRetryMs: 50, stallMs: 150, log: () => {} })
    ctrl = new MockDevice({ id: 'ctrl-1', caps: ['servo', 'bins'] })
    cam = new MockDevice({ id: 'cam-1', caps: ['camera'], angles: [3, 4] })
    check = new HardwareCheck({ devices: manager, queue: direct, captureTimeoutMs: 300, distTimeoutMs: 300 })
  })
  afterEach(async () => {
    await manager.stop()
  })

  describe('preview', () => {
    it('returns one JPEG from the camera, using the first angle it offers', async () => {
      await connect()
      const jpeg = await check.preview('cam-1')
      expect(isJpeg(jpeg)).toBe(true)
      expect(cam.captures).toEqual([{ scan_id: 0, angle: 3 }])
    })

    it('does not touch the servos', async () => {
      await connect()
      await check.preview('cam-1')
      expect(ctrl.sorts).toEqual([])
    })

    it('refuses a camera that is not connected', async () => {
      await connect({ camera: false })
      const err = await check.preview('cam-1').catch((e) => e)
      expect(err).toBeInstanceOf(CheckError)
      expect(err.code).toBe('NO_CAMERA')
    })

    it('explains a camera that does not deliver', async () => {
      await connect()
      cam.failAllCaptures = true
      const err = await check.preview('cam-1').catch((e) => e)
      expect(err).toBeInstanceOf(CheckError)
      expect(err.code).toBe('FAILED')
      expect(err.message).toMatch(/camera/i)
    })

    it('rejects data that is not a JPEG', async () => {
      await connect()
      cam.corruptNextCapture = true
      const err = await check.preview('cam-1').catch((e) => e)
      expect(err).toBeInstanceOf(CheckError)
      expect(err.code).toBe('FAILED')
    })

    it('runs inside the scan queue so it can never overlap a scan', async () => {
      await connect()
      const order: string[] = []
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      let tail: Promise<unknown> = Promise.resolve()
      const queue = {
        exclusive<T>(job: () => Promise<T>): Promise<T> {
          const run = tail.then(job)
          tail = run.catch(() => {})
          return run
        },
      }
      const queued = new HardwareCheck({ devices: manager, queue, captureTimeoutMs: 300, distTimeoutMs: 300 })
      void queue.exclusive(async () => {
        order.push('scan start')
        await gate
        order.push('scan end')
      })
      const photo = queued.preview('cam-1').then(() => order.push('preview'))
      await sleep(40)
      expect(cam.captures).toEqual([])
      release()
      await photo
      expect(order).toEqual(['scan start', 'scan end', 'preview'])
    })
  })

  describe('sensors', () => {
    it('reports a distance for each installed sensor and marks the rest absent', async () => {
      await connect()
      ctrl.setDistance(1, 23)
      ctrl.setDistance(2, null)
      const sensors = await check.sensors()
      expect(sensors).toHaveLength(8)
      expect(sensors[0]).toEqual({ bin: 1, state: 'ok', cm: 23 })
      expect(sensors[1]).toEqual({ bin: 2, state: 'absent', cm: null })
      expect(sensors[7].bin).toBe(8)
    })

    it('flags a sensor that hears no echo', async () => {
      await connect()
      ctrl.setDistance(1, -1)
      expect((await check.sensors())[0]).toEqual({ bin: 1, state: 'no_echo', cm: null })
    })

    it('follows a bin being filled', async () => {
      await connect()
      expect((await check.sensors())[2]).toMatchObject({ state: 'ok', cm: 30 })
      ctrl.setBinFull(3, true)
      expect((await check.sensors())[2]).toMatchObject({ state: 'ok', cm: 5 })
    })

    it('needs a controller', async () => {
      await connect({ controller: false })
      const err = await check.sensors().catch((e) => e)
      expect(err).toBeInstanceOf(CheckError)
      expect(err.code).toBe('NO_CONTROLLER')
    })

    it('explains a controller that never answers, e.g. older firmware', async () => {
      ctrl = new MockDevice({ id: 'ctrl-1', caps: ['servo', 'bins'], ignoreDistanceRequests: true })
      await connect()
      const err = await check.sensors().catch((e) => e)
      expect(err).toBeInstanceOf(CheckError)
      expect(err.code).toBe('FAILED')
      expect(err.message).toMatch(/1\.1/)
    })
  })
})
