import { SerialPort } from 'serialport'
import type { SerialMode } from '../config.ts'
import type { PortSource, PortSpec, Transport } from './transport.ts'

// USB-to-serial chips found on ESP32 boards and ESP32-CAM programmer bases.
const ESP_ADAPTER_VENDORS = new Set([
  '10c4', // Silicon Labs CP210x
  '1a86', // WCH CH340 / CH9102
  '0403', // FTDI
  '303a', // Espressif native USB
])

export function looksLikeEspAdapter(info: { vendorId?: string; productId?: string }): boolean {
  return info.vendorId !== undefined && ESP_ADAPTER_VENDORS.has(info.vendorId.toLowerCase())
}

/** The baud for an auto-detected port: its adapter's override when there is one, else the default. */
export function autoBaud(info: { vendorId?: string }, mode: { baud: number; adapterBauds: Record<string, number> }): number {
  return (info.vendorId && mode.adapterBauds[info.vendorId.toLowerCase()]) || mode.baud
}

class SerialTransport implements Transport {
  readonly name: string
  private readonly port: SerialPort
  private closeCb: ((err?: Error) => void) | null = null
  private closedOnce = false

  constructor(port: SerialPort, name: string) {
    this.port = port
    this.name = name
    port.on('close', () => this.fireClose())
    port.on('error', (err) => this.fireClose(err))
  }

  write(data: Buffer | string): void {
    if (!this.port.isOpen) return
    this.port.write(data, (err) => {
      if (err) this.fireClose(err)
    })
  }

  onData(cb: (chunk: Buffer) => void): void {
    this.port.on('data', cb)
  }

  onClose(cb: (err?: Error) => void): void {
    this.closeCb = cb
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.port.isOpen) {
        this.fireClose()
        resolve()
        return
      }
      this.port.close(() => {
        this.fireClose()
        resolve()
      })
    })
  }

  private fireClose(err?: Error): void {
    if (this.closedOnce) return
    this.closedOnce = true
    this.closeCb?.(err)
  }
}

/** Real USB serial ports. */
export class SerialPortSource implements PortSource {
  private readonly mode: Extract<SerialMode, { kind: 'auto' | 'list' }>

  constructor(mode: Extract<SerialMode, { kind: 'auto' | 'list' }>) {
    this.mode = mode
  }

  async list(): Promise<PortSpec[]> {
    const mode = this.mode
    if (mode.kind === 'list') return mode.ports
    const found = await SerialPort.list()
    return found.filter(looksLikeEspAdapter).map((p) => ({ path: p.path, baud: autoBaud(p, mode) }))
  }

  open(spec: PortSpec): Promise<Transport> {
    return new Promise((resolve, reject) => {
      // hupcl:false and DTR/RTS low keep the USB-serial chip from pulsing the
      // ESP32 reset and boot pins every time the server connects.
      const port = new SerialPort({ path: spec.path, baudRate: spec.baud, autoOpen: false, hupcl: false })
      port.open((err) => {
        if (err) {
          reject(new Error(describeOpenError(err)))
          return
        }
        port.set({ dtr: false, rts: false }, () => {})
        resolve(new SerialTransport(port, spec.path))
      })
    })
  }
}

function describeOpenError(err: Error): string {
  const msg = err.message
  if (/access denied|busy|in use|permission/i.test(msg)) {
    return msg + ' (is the Arduino IDE Serial Monitor or another program holding the port?)'
  }
  return msg
}
