// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EventHub, type SseSink } from './events.ts'

function sink() {
  const chunks: string[] = []
  const handlers: Record<string, () => void> = {}
  const s: SseSink = {
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    onClose(cb: () => void) {
      handlers.close = cb
    },
  }
  return { s, chunks, close: () => handlers.close?.() }
}

describe('EventHub', () => {
  it('formats events as server-sent events', () => {
    const hub = new EventHub()
    const a = sink()
    hub.subscribe(a.s)
    hub.emit('scan.created', { scan_id: 5 })
    expect(a.chunks.at(-1)).toBe('event: scan.created\ndata: {"scan_id":5}\n\n')
  })

  it('tells a new subscriber how long to wait before reconnecting', () => {
    const hub = new EventHub()
    const a = sink()
    hub.subscribe(a.s)
    expect(a.chunks[0]).toBe('retry: 2000\n\n')
  })

  it('delivers to every subscriber and stops after they close', () => {
    const hub = new EventHub()
    const a = sink()
    const b = sink()
    hub.subscribe(a.s)
    hub.subscribe(b.s)
    expect(hub.size).toBe(2)
    a.close()
    expect(hub.size).toBe(1)
    hub.emit('bin.updated', [])
    expect(a.chunks.some((c) => c.includes('bin.updated'))).toBe(false)
    expect(b.chunks.some((c) => c.includes('bin.updated'))).toBe(true)
  })

  it('drops a subscriber whose connection throws instead of failing the emit', () => {
    const hub = new EventHub()
    const good = sink()
    hub.subscribe({
      write() {
        throw new Error('socket destroyed')
      },
      onClose() {},
    })
    hub.subscribe(good.s)
    expect(() => hub.emit('x', 1)).not.toThrow()
    expect(hub.size).toBe(1)
  })

  it('sends keepalive comments', () => {
    const hub = new EventHub()
    const a = sink()
    hub.subscribe(a.s)
    hub.keepalive()
    expect(a.chunks.at(-1)).toBe(': keepalive\n\n')
  })
})
