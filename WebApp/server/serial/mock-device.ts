import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FrameParser } from './frame-parser.ts'
import type { PortSource, PortSpec, Transport } from './transport.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_MOCK_FRAMES_DIR = path.resolve(HERE, '../dev/mock-frames')

// Passes the JPEG sanity check but is not renderable. Only used if no sample
// frames can be found on disk.
const PLACEHOLDER_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9])

/** Returns a function mapping a camera angle to the bytes the fake camera sends. */
export function loadMockFrames(dir: string = DEFAULT_MOCK_FRAMES_DIR): (angle: number) => Buffer {
  let files: Buffer[] = []
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => /\.jpe?g$/i.test(f))
      .sort()
      .map((f) => fs.readFileSync(path.join(dir, f)))
  } catch {
    files = []
  }
  if (files.length === 0) return () => PLACEHOLDER_JPEG
  return (angle) => files[(Math.max(1, angle) - 1) % files.length]
}

const EMPTY_BIN_CM = 30
const FULL_BIN_CM = 5

export interface MockDeviceOptions {
  id: string
  caps: string[]
  angles?: number[]
  fw?: string
  /** Never answer the hello probe, like a dead or foreign device. */
  silent?: boolean
  /** Simulated servo travel time reported in the ack. */
  ackMs?: number
  frames?: (angle: number) => Buffer
  /** How many bytes of an image go out per write, to exercise reassembly. */
  chunkSize?: number
  /** Stay silent when asked for distances, like firmware older than 1.1. */
  ignoreDistanceRequests?: boolean
}

/**
 * An in-process stand-in for an ESP32 that speaks the real wire protocol. It
 * parses what the server writes with the same FrameParser, so protocol bugs show
 * up here the same way they would on hardware.
 */
export class MockDevice implements Transport {
  readonly name: string
  closed = false
  sorts: { scan_id: number; bin: number; s1: string; s2: string }[] = []
  captures: { scan_id: number; angle: number }[] = []
  failNextCapture = false
  failAllCaptures = false
  corruptNextCapture = false
  truncateNextCapture = false
  onSort: ((s: { scan_id: number; bin: number }) => void) | null = null

  private readonly opts: MockDeviceOptions
  private readonly frames: (angle: number) => Buffer
  private readonly bins: boolean[] = Array.from({ length: 8 }, () => false)
  // What each bin's ultrasonic sensor reads: cm, -1 for no echo, null for no sensor installed.
  private readonly distances: (number | null)[] = Array.from({ length: 8 }, () => EMPTY_BIN_CM)
  private readonly parser = new FrameParser()
  private dataCb: ((chunk: Buffer) => void) | null = null
  private closeCb: (() => void) | null = null
  private out: Promise<void> = Promise.resolve()

  constructor(opts: MockDeviceOptions) {
    this.opts = opts
    this.name = 'mock:' + opts.id
    this.frames = opts.frames ?? loadMockFrames()
  }

  // Transport

  write(data: Buffer | string): void {
    if (this.closed) return
    const buf = typeof data === 'string' ? Buffer.from(data) : data
    for (const frame of this.parser.push(buf)) {
      if (frame.kind === 'json') this.handle(frame.msg)
    }
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.dataCb = cb
  }

  onClose(cb: () => void): void {
    this.closeCb = cb
  }

  async close(): Promise<void> {
    this.fireClose()
  }

  // Test and demo controls

  disconnect(): void {
    this.fireClose()
  }

  setBinFull(bin: number, full: boolean): void {
    if (bin < 1 || bin > 8) return
    this.bins[bin - 1] = full
    if (this.distances[bin - 1] !== null) this.distances[bin - 1] = full ? FULL_BIN_CM : EMPTY_BIN_CM
    if (this.opts.caps.includes('bins')) this.sendJson({ t: 'bin', bin, full })
  }

  /** Set what a bin's sensor reads: cm, -1 for no echo, null for no sensor installed. */
  setDistance(bin: number, cm: number | null): void {
    if (bin < 1 || bin > 8) return
    this.distances[bin - 1] = cm
  }

  pressMango(): void {
    this.sendJson({ t: 'mango' })
  }

  // Firmware behaviour

  private handle(msg: Record<string, unknown>): void {
    const { caps, id } = this.opts
    switch (msg.t) {
      case 'hello?':
        if (this.opts.silent) return
        this.sendJson({ t: 'hello', id, caps, angles: this.opts.angles, fw: this.opts.fw ?? 'mock-1.0' })
        return
      case 'ping':
        this.sendJson({ t: 'pong' })
        return
      case 'bins?':
        if (!caps.includes('bins')) return
        this.bins.forEach((full, i) => this.sendJson({ t: 'bin', bin: i + 1, full }))
        return
      case 'dist?':
        if (!caps.includes('bins') || this.opts.ignoreDistanceRequests) return
        this.sendJson({ t: 'dist', cm: this.distances })
        return
      case 'sort': {
        if (!caps.includes('servo')) return
        const sort = { scan_id: Number(msg.scan_id), bin: Number(msg.bin), s1: String(msg.s1), s2: String(msg.s2) }
        this.sorts.push(sort)
        this.onSort?.(sort)
        const ms = this.opts.ackMs ?? 5
        setTimeout(() => this.sendJson({ t: 'ack', scan_id: sort.scan_id, ok: true, ms }), ms)
        return
      }
      case 'capture':
        if (caps.includes('camera')) this.capture(Number(msg.scan_id), Number(msg.angle))
        return
      default:
    }
  }

  private capture(scanId: number, angle: number): void {
    this.captures.push({ scan_id: scanId, angle })
    if (this.failNextCapture || this.failAllCaptures) {
      this.failNextCapture = false
      return
    }
    let data = this.frames(angle)
    if (this.corruptNextCapture) {
      this.corruptNextCapture = false
      data = Buffer.from('this is definitely not a jpeg image')
    }
    this.sendJson({ t: 'img', scan_id: scanId, angle, len: data.length })
    if (this.truncateNextCapture) {
      this.truncateNextCapture = false
      this.sendBytes(data.subarray(0, Math.floor(data.length / 2)))
      return
    }
    this.sendBytes(data)
  }

  // Output is asynchronous and ordered, like a real UART

  private sendJson(obj: object): void {
    this.sendBytes(Buffer.from(JSON.stringify(obj) + '\n'))
  }

  private sendBytes(buf: Buffer): void {
    const size = this.opts.chunkSize ?? 512
    for (let i = 0; i < buf.length; i += size) {
      const chunk = buf.subarray(i, i + size)
      this.out = this.out.then(
        () =>
          new Promise<void>((resolve) =>
            setImmediate(() => {
              if (!this.closed) this.dataCb?.(chunk)
              resolve()
            }),
          ),
      )
    }
  }

  private fireClose(): void {
    if (this.closed) return
    this.closed = true
    this.closeCb?.()
  }
}

/** Ports that exist only while plugged in. Lets tests and mock mode simulate cables. */
export class MockPortSource implements PortSource {
  private readonly plugged = new Map<string, () => MockDevice>()
  private readonly last = new Map<string, MockDevice>()

  plug(portPath: string, factory: () => MockDevice): void {
    this.plugged.set(portPath, factory)
  }

  unplug(portPath: string): void {
    this.plugged.delete(portPath)
    this.last.get(portPath)?.disconnect()
  }

  opened(portPath: string): MockDevice | undefined {
    return this.last.get(portPath)
  }

  async list(): Promise<PortSpec[]> {
    return [...this.plugged.keys()].map((p) => ({ path: p, baud: 921600 }))
  }

  async open(spec: PortSpec): Promise<Transport> {
    const factory = this.plugged.get(spec.path)
    if (!factory) throw new Error('no such port: ' + spec.path)
    const dev = factory()
    this.last.set(spec.path, dev)
    return dev
  }
}
