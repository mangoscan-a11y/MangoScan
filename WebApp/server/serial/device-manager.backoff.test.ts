// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceManager } from './device-manager.ts'
import { MockDevice, MockPortSource } from './mock-device.ts'
import type { PortSpec, Transport } from './transport.ts'
import { sleep } from '../test/helpers.ts'

class RecordingSource extends MockPortSource {
  opens: number[] = []
  override async open(spec: PortSpec): Promise<Transport> {
    this.opens.push(Date.now())
    return super.open(spec)
  }
}

const mute = () => new MockDevice({ id: 'stranger', caps: ['servo'], silent: true })

describe('DeviceManager retry policy', () => {
  let manager: DeviceManager
  afterEach(async () => {
    await manager.stop()
  })

  it('waits longer after every failed attempt on a port that never answers', async () => {
    const source = new RecordingSource()
    source.plug('COM9', mute)
    manager = new DeviceManager(source, { pollMs: 10, helloTimeoutMs: 60, helloRetryMs: 20, cooldownMs: 120, log: () => {} })
    manager.start()
    await sleep(1200)
    expect(source.opens.length).toBeGreaterThanOrEqual(3)
    // Attempts are roughly 180 ms, then 300 ms apart: the second gap must be clearly longer.
    const [a, b, c] = source.opens
    expect(c - b).toBeGreaterThan(b - a + 50)
  })

  it('gives up on a port after maxFailures until it is unplugged and replugged', async () => {
    const source = new RecordingSource()
    source.plug('COM9', mute)
    manager = new DeviceManager(source, {
      pollMs: 10, helloTimeoutMs: 40, helloRetryMs: 20, cooldownMs: 20, maxFailures: 2, log: () => {},
    })
    manager.start()
    await sleep(600)
    expect(source.opens).toHaveLength(2)

    source.unplug('COM9')
    await sleep(60)
    source.plug('COM9', mute)
    await sleep(250)
    expect(source.opens.length).toBeGreaterThan(2)
  })

  it('never gives up by default, so a slow-booting board on a named port is still found', async () => {
    const source = new RecordingSource()
    let ready = false
    source.plug('COM3', () => new MockDevice({ id: 'late', caps: ['servo'], silent: !ready }))
    manager = new DeviceManager(source, { pollMs: 10, helloTimeoutMs: 40, helloRetryMs: 20, cooldownMs: 20, log: () => {} })
    manager.start()
    await sleep(300)
    expect(manager.controller()).toBeUndefined()
    ready = true
    await sleep(900)
    expect(manager.controller()?.info.id).toBe('late')
  })
})
