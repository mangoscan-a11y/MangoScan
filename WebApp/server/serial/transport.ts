/** A byte pipe to one device. The real one is a serial port; tests use an in-process mock. */
export interface Transport {
  readonly name: string
  write(data: Buffer | string): void
  onData(cb: (chunk: Buffer) => void): void
  /** Fires once when the pipe closes for any reason (unplugged, closed, error). */
  onClose(cb: (err?: Error) => void): void
  close(): Promise<void>
}

export interface PortSpec {
  path: string
  baud: number
}

/** Where candidate ports come from and how to open one. */
export interface PortSource {
  list(): Promise<PortSpec[]>
  open(spec: PortSpec): Promise<Transport>
}
