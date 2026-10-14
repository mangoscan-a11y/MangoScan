// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FrameParser, type Frame } from './frame-parser.ts'

const line = (obj: unknown) => Buffer.from(JSON.stringify(obj) + '\n')
const jpegLike = (n: number) => {
  const b = Buffer.alloc(n, 0x41)
  b[0] = 0xff
  b[1] = 0xd8
  b[n - 2] = 0xff
  b[n - 1] = 0xd9
  return b
}

describe('FrameParser', () => {
  it('splits several JSON lines delivered in one chunk', () => {
    const p = new FrameParser()
    const frames = p.push(Buffer.concat([line({ t: 'ping' }), line({ t: 'bin', bin: 3, full: true })]))
    expect(frames).toEqual([
      { kind: 'json', msg: { t: 'ping' } },
      { kind: 'json', msg: { t: 'bin', bin: 3, full: true } },
    ])
  })

  it('reassembles a line split across chunks and tolerates CRLF', () => {
    const p = new FrameParser()
    expect(p.push(Buffer.from('{"t":"po'))).toEqual([])
    expect(p.push(Buffer.from('ng"}\r\n'))).toEqual([{ kind: 'json', msg: { t: 'pong' } }])
  })

  it('reads exactly len raw bytes after an img header, even if they contain newlines and braces', () => {
    const p = new FrameParser()
    const payload = jpegLike(64)
    payload.write('\n{"t":"ping"}\n', 10)
    const frames = p.push(Buffer.concat([line({ t: 'img', scan_id: 7, angle: 2, len: 64 }), payload]))
    expect(frames).toHaveLength(1)
    const f = frames[0] as Extract<Frame, { kind: 'image' }>
    expect(f.kind).toBe('image')
    expect(f.header).toEqual({ scan_id: 7, angle: 2, len: 64 })
    expect(f.data.equals(payload)).toBe(true)
  })

  it('assembles an image fed one byte at a time and keeps parsing afterwards', () => {
    const p = new FrameParser()
    const payload = jpegLike(40)
    const wire = Buffer.concat([line({ t: 'img', scan_id: 1, angle: 1, len: 40 }), payload, line({ t: 'pong' })])
    const frames: Frame[] = []
    for (const byte of wire) frames.push(...p.push(Buffer.from([byte])))
    expect(frames.map((f) => f.kind)).toEqual(['image', 'json'])
    expect((frames[0] as Extract<Frame, { kind: 'image' }>).data.equals(payload)).toBe(true)
  })

  it('reports non-JSON lines (ESP32 boot noise) as junk and keeps going', () => {
    const p = new FrameParser()
    const boot = Buffer.from('ets Jun  8 2016 00:22:57\r\nrst:0x1 (POWERON_RESET)\r\n')
    const frames = p.push(Buffer.concat([boot, line({ t: 'hello', id: 'ctrl-1' })]))
    expect(frames.map((f) => f.kind)).toEqual(['junk', 'junk', 'json'])
  })

  it('rejects an img header whose len is absurd instead of swallowing the stream', () => {
    const p = new FrameParser({ maxImage: 1000 })
    const frames = p.push(Buffer.concat([line({ t: 'img', scan_id: 1, angle: 1, len: 5_000_000 }), line({ t: 'pong' })]))
    expect(frames.map((f) => f.kind)).toEqual(['junk', 'json'])
    expect(p.receivingImage).toBe(false)
  })

  it('abortImage drops a half-received image so the next JSON line parses', () => {
    const p = new FrameParser()
    expect(p.push(Buffer.concat([line({ t: 'img', scan_id: 1, angle: 1, len: 500 }), Buffer.alloc(100, 1)]))).toEqual([])
    expect(p.receivingImage).toBe(true)
    expect(p.abortImage()).toBe(true)
    expect(p.receivingImage).toBe(false)
    expect(p.push(line({ t: 'pong' }))).toEqual([{ kind: 'json', msg: { t: 'pong' } }])
    expect(p.abortImage()).toBe(false)
  })

  it('discards an over-long line with no newline rather than buffering forever', () => {
    const p = new FrameParser({ maxLine: 64 })
    const frames = p.push(Buffer.alloc(200, 0x58))
    expect(frames.map((f) => f.kind)).toEqual(['junk'])
    expect(p.push(line({ t: 'pong' }))).toEqual([{ kind: 'json', msg: { t: 'pong' } }])
  })

  it('treats JSON that is not an object as junk', () => {
    const p = new FrameParser()
    expect(p.push(Buffer.from('123\n[1,2]\n')).map((f) => f.kind)).toEqual(['junk', 'junk'])
  })
})
