import type { Db } from 'mongodb'
import { COLLECTIONS } from '../db.ts'
import type { EventHub } from '../events.ts'
import type { DeviceManager } from '../serial/device-manager.ts'
import type { BinManager } from './bin-manager.ts'
import type { Orchestrator } from './orchestrator.ts'

export interface WiringDeps {
  devices: DeviceManager
  bins: BinManager
  hub: EventHub
  db: Db
  orchestrator: Pick<Orchestrator, 'scan'>
  log: (msg: string) => void
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Connects what the ESP32s report to everything that reacts to it. */
export function wireDevices({ devices, bins, hub, db, orchestrator, log }: WiringDeps): void {
  devices.on('bin', (r) => {
    bins.report(r.bin, r.full).catch((err) => log('could not record bin ' + r.bin + ': ' + message(err)))
  })

  devices.on('mango', () => {
    orchestrator.scan('device').catch((err) => log('automatic scan skipped: ' + message(err)))
  })

  devices.on('log', (e) => log('[' + e.device + '] ' + e.msg))

  let connected = new Set<string>()
  devices.on('status', (list) => {
    hub.emit('device.status', list)
    const now = new Set(list.filter((d) => d.connected).map((d) => d.id))
    const changes: { id: string; connected: boolean }[] = [
      ...[...now].filter((id) => !connected.has(id)).map((id) => ({ id, connected: true })),
      ...[...connected].filter((id) => !now.has(id)).map((id) => ({ id, connected: false })),
    ]
    connected = now
    for (const c of changes) {
      db.collection(COLLECTIONS.deviceEvents)
        .insertOne({ ts: new Date(), type: 'device', id: c.id, connected: c.connected })
        .catch((err) => log('could not record device event: ' + message(err)))
    }
  })
}
