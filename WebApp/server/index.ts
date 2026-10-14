import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'
import { connectDb, ensureIndexes, seedReference, syncScanCounter } from './db.ts'
import { EventHub } from './events.ts'
import { BinManager } from './machine/bin-manager.ts'
import { HardwareCheck } from './machine/hardware-check.ts'
import { InferenceClient } from './machine/inference.ts'
import { Orchestrator } from './machine/orchestrator.ts'
import { RefCache } from './machine/ref-cache.ts'
import { wireDevices } from './machine/wiring.ts'
import { DeviceManager } from './serial/device-manager.ts'
import { MockDevice, MockPortSource, loadMockFrames } from './serial/mock-device.ts'
import { SerialPortSource } from './serial/serial-source.ts'
import type { PortSource } from './serial/transport.ts'

try {
  process.loadEnvFile('.env')
} catch {
  // no .env, defaults apply
}

if (process.argv.includes('--mock')) process.env.SERIAL_PORTS = 'mock'

const stamp = () => new Date().toLocaleTimeString('en-GB')
const log = (msg: string) => console.log('[' + stamp() + '] ' + msg)

const config = loadConfig(process.env, process.cwd())
let handle: Awaited<ReturnType<typeof connectDb>>
try {
  handle = await connectDb(config.mongoUri, config.mongoDb)
} catch (err) {
  console.error('\n' + (err instanceof Error ? err.message : String(err)))
  console.error('Start the MongoDB service (Windows Services, "MongoDB Server") and run this again.')
  process.exit(1)
}
const { client, db } = handle
await ensureIndexes(db)
await seedReference(db)
await syncScanCounter(db)
log('MongoDB ready: ' + config.mongoUri + ' / ' + config.mongoDb)

const hub = new EventHub()
const refs = new RefCache(db)
await refs.load()
const bins = new BinManager(db, hub)
await bins.load()

let source: PortSource
let mock: { controller: MockDevice } | null = null
const serial = config.serial
if (serial.kind === 'mock') {
  const mockSource = new MockPortSource()
  const frames = loadMockFrames(config.mockImageDir ?? undefined)
  const controller = new MockDevice({ id: 'mock-controller', caps: ['servo', 'bins', 'mango'], ackMs: 40 })
  const camera = new MockDevice({ id: 'mock-camera', caps: ['camera'], angles: [1, 2, 3, 4, 5], frames })
  mockSource.plug('MOCK-CONTROLLER', () => controller)
  mockSource.plug('MOCK-CAMERA', () => camera)
  source = mockSource
  mock = { controller }
  log('MOCK MODE: using a simulated controller and camera, no hardware needed')
} else if (serial.kind === 'none') {
  source = { list: async () => [], open: async () => Promise.reject(new Error('no serial ports configured')) }
  log('Serial devices disabled (SERIAL_PORTS=none)')
} else {
  source = new SerialPortSource(serial)
  log('Looking for ESP32 boards on USB serial (' + (serial.kind === 'auto' ? 'auto-detect' : serial.ports.map((p) => p.path).join(', ')) + ')')
}

// With auto-detect, other USB-serial gadgets on the laptop get a few probes and are then left alone.
const devices = new DeviceManager(source, { log: (m) => log(m), maxFailures: serial.kind === 'auto' ? 5 : Infinity })
const inference = new InferenceClient(config.inferenceUrl, config.inferenceTimeoutMs)
const orchestrator = new Orchestrator({ db, refs, bins, hub, devices, inference, storageDir: config.storageDir, log })
const check = new HardwareCheck({ devices, queue: orchestrator })
wireDevices({ devices, bins, hub, db, orchestrator, log })

const app = createApp({
  config,
  db,
  refs,
  bins,
  hub,
  devices,
  orchestrator,
  check,
  inference,
  mode: mock ? 'mock' : 'serial',
  mock,
  log,
})

if (!fs.existsSync(path.join(config.distDir, 'index.html'))) {
  log('Dashboard is not built yet: run "npm run build" first (or use "npm run dev" and open the address Vite prints).')
}

const server = app.listen(config.port, config.host, () => {
  log('Dashboard: http://localhost:' + config.port)
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) log('On the network: http://' + a.address + ':' + config.port)
    }
    log('WARNING: anyone on this network can operate the machine. Use HOST=127.0.0.1 to restrict it to this laptop.')
  }
  devices.start()
})
server.on('error', (err: NodeJS.ErrnoException) => {
  console.error(err.code === 'EADDRINUSE' ? 'Port ' + config.port + ' is already in use. Is the server already running?' : err.message)
  process.exit(1)
})

const keepalive = setInterval(() => hub.keepalive(), 15000)

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  log(signal + ' received, shutting down')
  clearInterval(keepalive)
  await devices.stop()
  server.closeAllConnections()
  server.close()
  await client.close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
