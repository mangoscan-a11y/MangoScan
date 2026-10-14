import { EventEmitter } from 'node:events'
import { z } from 'zod'
import { DeviceLink } from './device-link.ts'
import { isJpeg } from './jpeg.ts'
import type { Frame } from './frame-parser.ts'
import type { PortSource, PortSpec } from './transport.ts'

export interface DeviceInfo {
  id: string
  port: string
  caps: string[]
  angles: number[]
  fw: string | null
  connected: boolean
  connected_at: string | null
  last_seen: string | null
}

export interface BinReport {
  bin: number
  full: boolean
}

export interface SortCommand {
  scanId: number
  bin: number
  s1: string
  s2: string
}

export interface ManagerOptions {
  pollMs?: number
  helloTimeoutMs?: number
  helloRetryMs?: number
  stallMs?: number
  heartbeatMs?: number
  /** After a failed or rejected connection, wait this long before retrying that port. It doubles on every further failure. */
  cooldownMs?: number
  /** Stop probing a port after this many failures, until it disappears and returns. Default: never. */
  maxFailures?: number
  log?: (msg: string) => void
}

// Everything a device sends is untrusted input and is validated before use.
const helloSchema = z.object({
  t: z.literal('hello'),
  id: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
  caps: z.array(z.enum(['servo', 'bins', 'camera', 'mango'])).max(8),
  angles: z.array(z.number().int().min(1).max(9)).max(9).optional(),
  fw: z.string().max(32).optional(),
})
type Hello = z.infer<typeof helloSchema>
const binSchema = z.object({ t: z.literal('bin'), bin: z.number().int().min(1).max(8), full: z.boolean() })
const ackSchema = z.object({ t: z.literal('ack'), ok: z.boolean(), ms: z.number().nonnegative().max(60000).optional() })

const MANGO_DEBOUNCE_MS = 300

function isCaptureReply(scanId: number, angle: number, f: Frame): boolean {
  if (f.kind === 'image') return f.header.scan_id === scanId && f.header.angle === angle
  if (f.kind === 'json') return f.msg.t === 'err' && f.msg.scan_id === scanId && f.msg.angle === angle
  return false
}

export class Device {
  readonly info: DeviceInfo
  readonly link: DeviceLink

  constructor(info: DeviceInfo, link: DeviceLink) {
    this.info = info
    this.link = link
  }

  /** Ask the camera for one frame. Resolves with validated JPEG bytes. */
  async capture(scanId: number, angle: number, timeoutMs: number): Promise<Buffer> {
    const frame = await this.link.request(
      { t: 'capture', scan_id: scanId, angle },
      (f) => isCaptureReply(scanId, angle, f),
      timeoutMs,
    )
    if (frame.kind === 'json') {
      throw new Error('camera reported an error: ' + String(frame.msg.msg ?? 'unknown').slice(0, 100))
    }
    if (frame.kind !== 'image' || !isJpeg(frame.data)) throw new Error('camera sent data that is not a valid JPEG')
    return frame.data
  }

  /** Send a servo command and wait for the controller acknowledgement. */
  async sort(cmd: SortCommand, timeoutMs: number): Promise<{ ok: boolean; ms: number | null }> {
    const frame = await this.link.request(
      { t: 'sort', scan_id: cmd.scanId, bin: cmd.bin, s1: cmd.s1, s2: cmd.s2 },
      (f) => f.kind === 'json' && f.msg.t === 'ack' && f.msg.scan_id === cmd.scanId,
      timeoutMs,
    )
    const ack = frame.kind === 'json' ? ackSchema.safeParse(frame.msg) : null
    if (!ack?.success) return { ok: false, ms: null }
    return { ok: ack.data.ok, ms: ack.data.ms ?? null }
  }
}

/** Finds devices, handshakes with them, keeps them connected, and fans out their events. */
export class DeviceManager extends EventEmitter {
  private readonly source: PortSource
  private readonly pollMs: number
  private readonly helloTimeoutMs: number
  private readonly helloRetryMs: number
  private readonly stallMs: number
  private readonly heartbeatMs: number
  private readonly cooldownMs: number
  private readonly maxFailures: number
  private readonly log: (msg: string) => void

  private readonly devices = new Map<string, Device>()
  private readonly known = new Map<string, DeviceInfo>()
  private readonly inUse = new Set<string>()
  private readonly cooldownUntil = new Map<string, number>()
  private readonly complained = new Set<string>()
  private readonly failures = new Map<string, number>()
  private readonly gaveUp = new Set<string>()
  private poller: NodeJS.Timeout | null = null
  private heart: NodeJS.Timeout | null = null
  private polling = false
  private stopped = true
  private lastMango = 0

  constructor(source: PortSource, opts: ManagerOptions = {}) {
    super()
    this.source = source
    this.pollMs = opts.pollMs ?? 3000
    this.helloTimeoutMs = opts.helloTimeoutMs ?? 6000
    this.helloRetryMs = opts.helloRetryMs ?? 800
    this.stallMs = opts.stallMs ?? 1500
    this.heartbeatMs = opts.heartbeatMs ?? 5000
    this.cooldownMs = opts.cooldownMs ?? 4000
    this.maxFailures = opts.maxFailures ?? Infinity
    this.log = opts.log ?? ((m) => console.log('[devices]', m))
  }

  override on(event: 'status', cb: (devices: DeviceInfo[]) => void): this
  override on(event: 'bin', cb: (report: BinReport) => void): this
  override on(event: 'mango', cb: () => void): this
  override on(event: 'log', cb: (entry: { device: string; msg: string }) => void): this
  override on(event: string, cb: (...args: never[]) => void): this {
    return super.on(event, cb as (...args: unknown[]) => void)
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.poll()
    this.poller = setInterval(() => void this.poll(), this.pollMs)
    this.heart = setInterval(() => this.heartbeat(), this.heartbeatMs)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.poller) clearInterval(this.poller)
    if (this.heart) clearInterval(this.heart)
    this.poller = null
    this.heart = null
    await Promise.all([...this.devices.values()].map((d) => d.link.close().catch(() => {})))
  }

  controller(): Device | undefined {
    return [...this.devices.values()].find((d) => d.info.caps.includes('servo'))
  }

  cameras(): Device[] {
    return [...this.devices.values()].filter((d) => d.info.caps.includes('camera'))
  }

  status(): DeviceInfo[] {
    return [...this.known.values()]
      .map((i) => ({ ...i, caps: [...i.caps], angles: [...i.angles] }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  // discovery

  private async poll(): Promise<void> {
    if (this.polling) return
    if (this.stopped) return
    this.polling = true
    try {
      const specs = await this.source.list()
      const now = Date.now()
      this.forgetMissingPorts(new Set(specs.map((s) => s.path)))
      for (const spec of specs) {
        if (this.inUse.has(spec.path)) continue
        if (this.gaveUp.has(spec.path)) continue
        if ((this.cooldownUntil.get(spec.path) ?? 0) > now) continue
        this.inUse.add(spec.path)
        void this.connect(spec)
      }
    } catch (err) {
      this.complainOnce('list', 'cannot list serial ports: ' + errMsg(err))
    } finally {
      this.polling = false
    }
  }

  private async connect(spec: PortSpec): Promise<void> {
    let link: DeviceLink | null = null
    try {
      const transport = await this.source.open(spec)
      link = new DeviceLink(transport, { stallMs: this.stallMs })
      const hello = await this.handshake(link)
      if (!hello) throw new Error('no valid hello from device')
      if (this.stopped) throw new Error('shutting down')
      if (this.devices.get(hello.id)) throw new Error('id ' + hello.id + ' is already connected on another port')

      const now = new Date().toISOString()
      const info: DeviceInfo = {
        id: hello.id,
        port: spec.path,
        caps: hello.caps,
        angles: hello.angles ?? [],
        fw: hello.fw ?? null,
        connected: true,
        connected_at: now,
        last_seen: now,
      }
      const device = new Device(info, link)
      this.devices.set(info.id, device)
      this.known.set(info.id, info)
      this.complained.delete(spec.path)
      this.failures.delete(spec.path)
      this.log(info.id + ' connected on ' + spec.path + ' (' + info.caps.join(', ') + ')')

      link.on('message', (msg) => this.onMessage(device, msg))
      link.on('junk', () => {})
      link.on('closed', () => {
        if (this.devices.get(info.id) === device) this.devices.delete(info.id)
        info.connected = false
        this.inUse.delete(spec.path)
        this.log(info.id + ' disconnected from ' + spec.path)
        this.emitStatus()
      })

      this.emitStatus()
      if (info.caps.includes('bins')) link.send({ t: 'bins?' })
    } catch (err) {
      this.complainOnce(spec.path, spec.path + ': ' + errMsg(err))
      const failed = (this.failures.get(spec.path) ?? 0) + 1
      this.failures.set(spec.path, failed)
      const wait = Math.min(this.cooldownMs * 2 ** (failed - 1), 30000)
      this.cooldownUntil.set(spec.path, Date.now() + wait)
      if (failed >= this.maxFailures) {
        this.gaveUp.add(spec.path)
        this.log(spec.path + ': no MangoScan board answered, giving up on this port. Unplug and replug it to try again.')
      }
      this.inUse.delete(spec.path)
      await link?.close().catch(() => {})
    }
  }

  /** A port that vanished from the list starts fresh when it comes back. */
  private forgetMissingPorts(present: Set<string>): void {
    for (const tracked of [...this.failures.keys(), ...this.gaveUp, ...this.cooldownUntil.keys()]) {
      if (present.has(tracked) || this.inUse.has(tracked)) continue
      this.failures.delete(tracked)
      this.gaveUp.delete(tracked)
      this.cooldownUntil.delete(tracked)
      this.complained.delete(tracked)
    }
  }

  /** Probe until the device identifies itself, tolerating an ESP32 that reboots when the port opens. */
  private async handshake(link: DeviceLink): Promise<Hello | null> {
    const deadline = Date.now() + this.helloTimeoutMs
    while (Date.now() < deadline) {
      if (link.closed) return null
      try {
        const frame = await link.request(
          { t: 'hello?' },
          (f) => f.kind === 'json' && f.msg.t === 'hello',
          this.helloRetryMs,
        )
        if (frame.kind !== 'json') continue
        const parsed = helloSchema.safeParse(frame.msg)
        return parsed.success ? parsed.data : null
      } catch {
        // no answer yet, ask again
      }
    }
    return null
  }

  // traffic

  private onMessage(device: Device, msg: Record<string, unknown>): void {
    device.info.last_seen = new Date().toISOString()
    switch (msg.t) {
      case 'bin': {
        const r = binSchema.safeParse(msg)
        if (r.success) this.emit('bin', { bin: r.data.bin, full: r.data.full })
        return
      }
      case 'mango': {
        const now = Date.now()
        if (now - this.lastMango < MANGO_DEBOUNCE_MS) return
        this.lastMango = now
        this.emit('mango')
        return
      }
      case 'log':
        this.emit('log', { device: device.info.id, msg: String(msg.msg ?? '').slice(0, 200) })
        return
      case 'hello': {
        // The board rebooted without the cable moving. Refresh and re-sync bins.
        const r = helloSchema.safeParse(msg)
        if (r.success && r.data.id === device.info.id) {
          device.info.caps = r.data.caps
          device.info.angles = r.data.angles ?? []
          if (r.data.caps.includes('bins')) device.link.send({ t: 'bins?' })
          this.emitStatus()
        }
        return
      }
      default:
    }
  }

  private heartbeat(): void {
    const now = Date.now()
    for (const d of this.devices.values()) {
      const seen = d.info.last_seen ? Date.parse(d.info.last_seen) : now
      if (now - seen > this.heartbeatMs * 4) {
        this.log(d.info.id + ' stopped responding, dropping the connection')
        void d.link.close()
      } else {
        d.link.send({ t: 'ping' })
      }
    }
  }

  private emitStatus(): void {
    this.emit('status', this.status())
  }

  private complainOnce(key: string, msg: string): void {
    if (this.complained.has(key)) return
    this.complained.add(key)
    this.log(msg)
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
