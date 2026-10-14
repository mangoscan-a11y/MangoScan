import { EventEmitter } from 'node:events'
import { FrameParser, type Frame } from './frame-parser.ts'
import type { Transport } from './transport.ts'

interface Waiter {
  predicate: (f: Frame) => boolean
  resolve: (f: Frame) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

/**
 * One connected device: frames the byte stream, and turns "send this, wait for
 * that" into promises. Waiters are registered before the request is written, so
 * a fast reply can never be missed.
 */
export class DeviceLink extends EventEmitter {
  private readonly transport: Transport
  private readonly parser: FrameParser
  private readonly waiters = new Set<Waiter>()
  private readonly watchdog: NodeJS.Timeout
  private readonly stallMs: number
  private lastData = Date.now()
  private isClosed = false

  constructor(transport: Transport, opts: { stallMs?: number } = {}) {
    super()
    this.transport = transport
    this.parser = new FrameParser()
    this.stallMs = opts.stallMs ?? 1500
    transport.onData((chunk) => this.handleData(chunk))
    transport.onClose(() => this.handleClosed())
    // A device that resets mid-image would otherwise leave the parser waiting
    // for bytes that never come, swallowing every message after it.
    this.watchdog = setInterval(() => {
      if (this.parser.receivingImage && Date.now() - this.lastData > this.stallMs) {
        this.parser.abortImage()
        this.emit('junk', 'image transfer stalled and was dropped')
      }
    }, Math.max(20, Math.floor(this.stallMs / 3)))
    this.watchdog.unref()
  }

  override on(event: 'message', cb: (msg: Record<string, unknown>) => void): this
  override on(event: 'junk', cb: (text: string) => void): this
  override on(event: 'closed', cb: () => void): this
  override on(event: string, cb: (...args: never[]) => void): this {
    return super.on(event, cb as (...args: unknown[]) => void)
  }

  get closed(): boolean {
    return this.isClosed
  }

  get name(): string {
    return this.transport.name
  }

  send(msg: object): void {
    if (this.isClosed) return
    this.transport.write(JSON.stringify(msg) + '\n')
  }

  request(msg: object | null, predicate: (f: Frame) => boolean, timeoutMs: number): Promise<Frame> {
    return new Promise<Frame>((resolve, reject) => {
      if (this.isClosed) {
        reject(new Error('device disconnected'))
        return
      }
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          if (this.parser.receivingImage) this.parser.abortImage()
          reject(new Error(`timed out after ${timeoutMs} ms waiting for the device`))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
      if (msg) this.send(msg)
    })
  }

  async close(): Promise<void> {
    if (this.isClosed) return
    try {
      await this.transport.close()
    } finally {
      this.handleClosed()
    }
  }

  private handleData(chunk: Buffer): void {
    this.lastData = Date.now()
    for (const frame of this.parser.push(chunk)) this.dispatch(frame)
  }

  private dispatch(frame: Frame): void {
    for (const w of this.waiters) {
      let hit = false
      try {
        hit = w.predicate(frame)
      } catch {
        hit = false
      }
      if (hit) {
        this.waiters.delete(w)
        clearTimeout(w.timer)
        w.resolve(frame)
        return
      }
    }
    if (frame.kind === 'json') this.emit('message', frame.msg)
    else if (frame.kind === 'junk') this.emit('junk', frame.text)
  }

  private handleClosed(): void {
    if (this.isClosed) return
    this.isClosed = true
    clearInterval(this.watchdog)
    for (const w of this.waiters) {
      clearTimeout(w.timer)
      w.reject(new Error('device disconnected'))
    }
    this.waiters.clear()
    this.emit('closed')
  }
}
