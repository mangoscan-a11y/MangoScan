// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceManager } from './device-manager.ts'
import { MockDevice, MockPortSource } from './mock-device.ts'
import { isJpeg } from './jpeg.ts'
import { sleep, waitFor } from '../test/helpers.ts'

function controller(over = {}) {
  return new MockDevice({ id: 'ctrl-1', caps: ['servo', 'bins', 'mango'], ...over })
}
function camera(over = {}) {
  return new MockDevice({ id: 'cam-1', caps: ['camera'], angles: [1, 2, 3, 4, 5], ...over })
}

describe('DeviceManager', () => {
  let source: MockPortSource
  let manager: DeviceManager

  beforeEach(() => {
    source = new MockPortSource()
    manager = new DeviceManager(source, { pollMs: 20, helloTimeoutMs: 400, helloRetryMs: 50, stallMs: 150 })
  })
  afterEach(async () => {
    await manager.stop()
  })

  it('finds a controller and a camera and reports what each can do', async () => {
    source.plug('COM3', () => controller())
    source.plug('COM5', () => camera())
    manager.start()
    await waitFor(() => manager.controller() && manager.cameras().length === 1, 2000, 'both devices')

    const status = manager.status()
    expect(status.map((d) => [d.id, d.connected])).toEqual(expect.arrayContaining([['ctrl-1', true], ['cam-1', true]]))
    expect(manager.cameras()[0].info.angles).toEqual([1, 2, 3, 4, 5])
    expect(manager.controller()?.info.caps).toContain('servo')
  })

  it('captures a validated JPEG from the camera', async () => {
    source.plug('COM5', () => camera())
    manager.start()
    const cam = await waitFor(() => manager.cameras()[0], 2000, 'camera')
    const jpeg = await cam.capture(11, 3, 1000)
    expect(isJpeg(jpeg)).toBe(true)
  })

  it('rejects a capture the camera never answers', async () => {
    const dev = camera()
    source.plug('COM5', () => dev)
    manager.start()
    const cam = await waitFor(() => manager.cameras()[0], 2000, 'camera')
    dev.failNextCapture = true
    await expect(cam.capture(12, 1, 120)).rejects.toThrow(/timed out/i)
  })

  it('rejects bytes that are not a JPEG', async () => {
    const dev = camera()
    source.plug('COM5', () => dev)
    manager.start()
    const cam = await waitFor(() => manager.cameras()[0], 2000, 'camera')
    dev.corruptNextCapture = true
    await expect(cam.capture(13, 1, 500)).rejects.toThrow(/not a valid jpeg/i)
  })

  it('recovers after a camera stalls halfway through an image', async () => {
    const dev = camera()
    source.plug('COM5', () => dev)
    manager.start()
    const cam = await waitFor(() => manager.cameras()[0], 2000, 'camera')
    dev.truncateNextCapture = true
    await expect(cam.capture(14, 1, 300)).rejects.toThrow(/timed out/i)
    const jpeg = await cam.capture(14, 1, 1000)
    expect(isJpeg(jpeg)).toBe(true)
  })

  it('sends a sort command and returns the controller ack', async () => {
    const dev = controller({ ackMs: 7 })
    source.plug('COM3', () => dev)
    manager.start()
    const ctrl = await waitFor(() => manager.controller(), 2000, 'controller')
    const ack = await ctrl.sort({ scanId: 21, bin: 2, s1: 'group_green', s2: 'slot_medium' }, 1000)
    expect(ack).toEqual({ ok: true, ms: 7 })
    expect(dev.sorts).toEqual([{ scan_id: 21, bin: 2, s1: 'group_green', s2: 'slot_medium' }])
  })

  it('asks the controller for bin state on connect and forwards bin reports', async () => {
    const dev = controller()
    dev.setBinFull(4, true)
    const seen: { bin: number; full: boolean }[] = []
    manager.on('bin', (r) => seen.push(r))
    source.plug('COM3', () => dev)
    manager.start()
    await waitFor(() => seen.length >= 8, 2000, 'initial bin reports')
    expect(seen.find((r) => r.bin === 4)).toEqual({ bin: 4, full: true })

    dev.setBinFull(6, true)
    await waitFor(() => seen.some((r) => r.bin === 6 && r.full), 2000, 'live bin report')
  })

  it('emits a mango event when the arrival sensor fires, debounced', async () => {
    const dev = controller()
    let mangoes = 0
    manager.on('mango', () => mangoes++)
    source.plug('COM3', () => dev)
    manager.start()
    await waitFor(() => manager.controller(), 2000, 'controller')
    dev.pressMango()
    dev.pressMango()
    await sleep(80)
    expect(mangoes).toBe(1)
  })

  it('marks a device disconnected when unplugged and reconnects when it returns', async () => {
    source.plug('COM3', () => controller())
    manager.start()
    await waitFor(() => manager.controller(), 2000, 'controller')

    source.unplug('COM3')
    await waitFor(() => !manager.controller() && manager.status().some((d) => d.id === 'ctrl-1' && !d.connected), 2000, 'disconnect')

    source.plug('COM3', () => controller())
    await waitFor(() => manager.controller(), 2000, 'reconnect')
    expect(manager.status().filter((d) => d.id === 'ctrl-1')).toHaveLength(1)
  })

  it('refuses a second device that claims an id already in use', async () => {
    source.plug('COM3', () => controller())
    source.plug('COM4', () => controller())
    manager.start()
    await waitFor(() => manager.controller(), 2000, 'controller')
    await sleep(150)
    expect(manager.status().filter((d) => d.connected)).toHaveLength(1)
  })

  it('does not register a port whose device never says hello', async () => {
    source.plug('COM9', () => new MockDevice({ id: 'mute', caps: ['servo'], silent: true }))
    manager.start()
    await sleep(600)
    expect(manager.status()).toEqual([])
    expect(source.opened('COM9')?.closed).toBe(true)
  })

  it('ignores a hello with a hostile id', async () => {
    source.plug('COM3', () => controller({ id: '../../etc/passwd' }))
    manager.start()
    await sleep(500)
    expect(manager.controller()).toBeUndefined()
  })
})
