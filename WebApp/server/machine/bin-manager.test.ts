// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, mongoAvailable, type TestDb } from '../test/mongo.ts'
import { ensureIndexes } from '../db.ts'
import { EventHub } from '../events.ts'
import { BinManager } from './bin-manager.ts'

const hasMongo = await mongoAvailable()

function recordingHub() {
  const hub = new EventHub()
  const events: { event: string; data: string }[] = []
  hub.subscribe({
    write(chunk: string) {
      const m = /^event: (.+)\ndata: (.+)\n\n$/.exec(chunk)
      if (m) events.push({ event: m[1], data: m[2] })
      return true
    },
    onClose() {},
  })
  return { hub, events }
}

describe.skipIf(!hasMongo)('BinManager', () => {
  let t: TestDb
  beforeAll(async () => {
    t = await createTestDb()
    await ensureIndexes(t.db)
  })
  afterAll(async () => {
    await t.drop()
  })

  it('starts with eight empty bins', async () => {
    const { hub } = recordingHub()
    const bins = new BinManager(t.db, hub)
    await bins.load()
    expect(bins.list()).toHaveLength(8)
    expect(bins.fullSet().size).toBe(0)
  })

  it('records a bin filling up, tells clients, and remembers it across restarts', async () => {
    const { hub, events } = recordingHub()
    const bins = new BinManager(t.db, hub)
    await bins.load()
    expect(await bins.report(3, true)).toBe(true)
    expect(bins.fullSet().has(3)).toBe(true)

    const updates = events.filter((e) => e.event === 'bin.updated')
    expect(updates).toHaveLength(1)
    expect(JSON.parse(updates[0].data).find((b: { bin_index: number }) => b.bin_index === 3).full).toBe(true)

    const reloaded = new BinManager(t.db, recordingHub().hub)
    await reloaded.load()
    expect(reloaded.fullSet().has(3)).toBe(true)

    const history = await t.db.collection('device_events').find({ type: 'bin', bin: 3 }).toArray()
    expect(history.map((h) => h.full)).toEqual([true])
  })

  it('stays quiet when the controller repeats what we already know', async () => {
    const { hub, events } = recordingHub()
    const bins = new BinManager(t.db, hub)
    await bins.load()
    expect(await bins.report(3, true)).toBe(false)
    expect(events).toHaveLength(0)
  })

  it('clears a bin when it is emptied', async () => {
    const { hub } = recordingHub()
    const bins = new BinManager(t.db, hub)
    await bins.load()
    expect(await bins.report(3, false)).toBe(true)
    expect(bins.fullSet().size).toBe(0)
    const history = await t.db.collection('device_events').find({ type: 'bin', bin: 3 }).sort({ ts: 1 }).toArray()
    expect(history.map((h) => h.full)).toEqual([true, false])
  })
})
