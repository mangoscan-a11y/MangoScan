import path from 'node:path'

export type SerialMode =
  | { kind: 'auto'; baud: number; adapterBauds: Record<string, number> }
  | { kind: 'list'; ports: { path: string; baud: number }[] }
  | { kind: 'mock' }
  | { kind: 'none' }

export interface Config {
  mongoUri: string
  mongoDb: string
  host: string
  port: number
  storageDir: string
  distDir: string
  serial: SerialMode
  mockImageDir: string | null
  inferenceUrl: string
  inferenceTimeoutMs: number
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max} (got "${raw}")`)
  }
  return n
}

/** "10c4:115200,1a86:921600": a USB vendor id and the baud its boards use, for auto-detected ports. */
function parseAdapterBauds(raw: string | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const part of (raw ?? '').split(',')) {
    const item = part.trim()
    if (!item) continue
    const [vendorId = '', b = ''] = item.split(':')
    const baud = Number(b)
    if (!/^[0-9a-f]{4}$/i.test(vendorId) || !Number.isInteger(baud) || baud < 9600 || baud > 3_000_000) {
      throw new Error(`SERIAL_ADAPTER_BAUDS entries look like 10c4:115200 (got "${item}")`)
    }
    out[vendorId.toLowerCase()] = baud
  }
  return out
}

function parseSerial(env: NodeJS.ProcessEnv, baud: number): SerialMode {
  const raw = (env.SERIAL_PORTS ?? 'auto').trim()
  if (raw === 'auto') return { kind: 'auto', baud, adapterBauds: parseAdapterBauds(env.SERIAL_ADAPTER_BAUDS) }
  if (raw === 'mock') return { kind: 'mock' }
  if (raw === 'none' || raw === '') return { kind: 'none' }

  const ports = raw.split(',').map((part) => {
    const [p, b] = part.trim().split(':')
    if (!p || !/^[\w./-]+$/.test(p)) throw new Error(`SERIAL_PORTS has an invalid port name: "${part.trim()}"`)
    const portBaud = b === undefined ? baud : Number(b)
    if (!Number.isInteger(portBaud) || portBaud < 9600 || portBaud > 3_000_000) {
      throw new Error(`SERIAL_PORTS has an invalid baud rate: "${part.trim()}"`)
    }
    return { path: p, baud: portBaud }
  })
  return { kind: 'list', ports }
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd: string): Config {
  const host = env.HOST ?? '127.0.0.1'
  if (host.trim() === '') throw new Error('HOST must not be empty')

  const inferenceUrl = env.INFERENCE_URL ?? 'http://127.0.0.1:8765'
  if (!/^https?:\/\//.test(inferenceUrl)) throw new Error('INFERENCE_URL must start with http:// or https://')

  const baud = int(env, 'SERIAL_BAUD', 921600, 9600, 3_000_000)

  return {
    mongoUri: env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
    mongoDb: env.MONGODB_DB ?? 'mangoscan',
    host,
    port: int(env, 'PORT', 4000, 1, 65535),
    storageDir: path.resolve(cwd, env.STORAGE_DIR ?? 'storage'),
    distDir: path.resolve(cwd, 'dist'),
    serial: parseSerial(env, baud),
    mockImageDir: env.MOCK_IMAGE_DIR ? path.resolve(cwd, env.MOCK_IMAGE_DIR) : null,
    inferenceUrl: inferenceUrl.replace(/\/+$/, ''),
    inferenceTimeoutMs: int(env, 'INFERENCE_TIMEOUT_MS', 5000, 100, 120_000),
  }
}
