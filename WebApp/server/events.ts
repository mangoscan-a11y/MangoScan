/** Anything the hub can push server-sent events into (an HTTP response in production). */
export interface SseSink {
  write(chunk: string): unknown
  onClose(cb: () => void): void
}

/** Fan-out of live updates to every open dashboard. */
export class EventHub {
  private readonly sinks = new Set<SseSink>()

  get size(): number {
    return this.sinks.size
  }

  subscribe(sink: SseSink): () => void {
    this.sinks.add(sink)
    sink.onClose(() => this.sinks.delete(sink))
    try {
      sink.write('retry: 2000\n\n')
    } catch {
      this.sinks.delete(sink)
    }
    return () => this.sinks.delete(sink)
  }

  emit(event: string, data: unknown): void {
    this.broadcast('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')
  }

  /** Comment frames keep idle connections from being dropped by proxies and browsers. */
  keepalive(): void {
    this.broadcast(': keepalive\n\n')
  }

  private broadcast(chunk: string): void {
    for (const sink of [...this.sinks]) {
      try {
        sink.write(chunk)
      } catch {
        this.sinks.delete(sink)
      }
    }
  }
}
