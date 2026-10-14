/**
 * Incremental parser for the device wire format: newline-delimited JSON, with
 * binary JPEG payloads announced by an `img` header line.
 *
 *   {"t":"img","scan_id":42,"angle":1,"len":23456}\n<23456 raw bytes>
 *
 * Everything here is untrusted device input, so every limit is explicit and a
 * bad frame degrades to a `junk` frame instead of throwing or buffering forever.
 */

export interface ImageHeader {
  scan_id: number
  angle: number
  len: number
}

export type Frame =
  | { kind: 'json'; msg: Record<string, unknown> }
  | { kind: 'image'; header: ImageHeader; data: Buffer }
  | { kind: 'junk'; text: string }

export interface ParserOptions {
  /** Longest accepted text line, in bytes. */
  maxLine?: number
  /** Largest accepted JPEG payload, in bytes. */
  maxImage?: number
}

const LF = 0x0a

export class FrameParser {
  private buf: Buffer = Buffer.alloc(0)
  private pending: ImageHeader | null = null
  private readonly maxLine: number
  private readonly maxImage: number

  constructor(opts: ParserOptions = {}) {
    this.maxLine = opts.maxLine ?? 4096
    this.maxImage = opts.maxImage ?? 2 * 1024 * 1024
  }

  get receivingImage(): boolean {
    return this.pending !== null
  }

  /** Drop a half-received image (device reset or stalled mid-frame). */
  abortImage(): boolean {
    if (!this.pending) return false
    this.pending = null
    this.buf = Buffer.alloc(0)
    return true
  }

  push(chunk: Buffer): Frame[] {
    const frames: Frame[] = []
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk])

    for (;;) {
      if (this.pending) {
        const { len } = this.pending
        if (this.buf.length < len) break
        frames.push({ kind: 'image', header: this.pending, data: Buffer.from(this.buf.subarray(0, len)) })
        this.buf = this.buf.subarray(len)
        this.pending = null
        continue
      }

      const nl = this.buf.indexOf(LF)
      if (nl < 0) {
        if (this.buf.length > this.maxLine) {
          frames.push({ kind: 'junk', text: 'line too long' })
          this.buf = Buffer.alloc(0)
        }
        break
      }

      const raw = this.buf.subarray(0, nl).toString('utf8').replace(/\r$/, '')
      const tooLong = nl > this.maxLine
      this.buf = this.buf.subarray(nl + 1)
      if (tooLong) {
        frames.push({ kind: 'junk', text: 'line too long' })
        continue
      }
      if (raw.trim() === '') continue
      this.handleLine(raw, frames)
    }
    return frames
  }

  private handleLine(raw: string, frames: Frame[]): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      frames.push({ kind: 'junk', text: raw.slice(0, 120) })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      frames.push({ kind: 'junk', text: raw.slice(0, 120) })
      return
    }
    const msg = parsed as Record<string, unknown>

    if (msg.t === 'img') {
      const { scan_id, angle, len } = msg
      const ok =
        Number.isInteger(scan_id) &&
        Number.isInteger(angle) &&
        Number.isInteger(len) &&
        (len as number) >= 1 &&
        (len as number) <= this.maxImage
      if (!ok) {
        frames.push({ kind: 'junk', text: `bad img header: ${raw.slice(0, 100)}` })
        return
      }
      this.pending = { scan_id: scan_id as number, angle: angle as number, len: len as number }
      return
    }
    frames.push({ kind: 'json', msg })
  }
}
