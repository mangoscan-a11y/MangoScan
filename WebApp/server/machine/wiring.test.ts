// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mongoAvailable } from '../test/mongo.ts'
import { createHarness, type Harness } from '../test/harness.ts'
import { sleep, waitFor } from '../test/helpers.ts'

const hasMongo = await mongoAvailable()

describe.skipIf(!hasMongo)('device wiring', () => {
  let h: Harness
  beforeEach(async () => {
    h = await createHarness()
  })
  afterEach(async () => {
    await h.close()
  })

  it('turns a bin-full report from the controller into stored state and a live event', async () => {
    h.ctrl.setBinFull(5, true)
    await waitFor(() => h.bins.fullSet().has(5), 2000, 'bin 5 full')
    await waitFor(() => h.events.some((e) => e.event === 'bin.updated'), 2000, 'bin.updated event')
  })

  it('starts a scan when the arrival sensor fires', async () => {
    h.ctrl.pressMango()
    await waitFor(async () => (await h.t.db.collection('scans').countDocuments()) === 1, 3000, 'automatic scan')
    expect(h.ctrl.sorts).toHaveLength(1)
  })

  it('records and announces devices connecting', async () => {
    await waitFor(() => h.events.filter((e) => e.event === 'device.status').length >= 2, 2000, 'status events')
    const history = await h.t.db.collection('device_events').find({ type: 'device', connected: true }).toArray()
    expect(history.map((x) => x.id).sort()).toEqual(['cam-1', 'ctrl-1'])
  })

  it('records a device being unplugged', async () => {
    h.source.unplug('CAM')
    await waitFor(async () => (await h.t.db.collection('device_events').countDocuments({ type: 'device', connected: false, id: 'cam-1' })) === 1, 2000, 'disconnect record')
  })

  it('logs an automatic scan that cannot run instead of crashing', async () => {
    h.source.unplug('CAM')
    await waitFor(() => h.devices.cameras().length === 0, 2000, 'camera gone')
    h.ctrl.pressMango()
    await waitFor(() => h.logs.some((l) => l.includes('No camera')), 2000, 'log line')
    await sleep(50)
    expect(await h.t.db.collection('scans').countDocuments()).toBe(0)
  })
})
