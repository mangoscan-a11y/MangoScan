import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app.ts'
import type { Harness } from './harness.ts'

export interface RunningApp {
  base: string
  port: number
  close(): Promise<void>
}

export async function startApp(h: Harness, opts: { host?: string; mock?: boolean } = {}): Promise<RunningApp> {
  const app = createApp({
    config: { host: opts.host ?? '127.0.0.1', storageDir: h.storageDir, distDir: h.storageDir + '-nodist' },
    db: h.t.db,
    refs: h.refs,
    bins: h.bins,
    hub: h.hub,
    devices: h.devices,
    orchestrator: h.orchestrator,
    inference: { health: async () => ({ ok: true }) },
    mode: opts.mock ? 'mock' : 'serial',
    mock: opts.mock ? { controller: h.ctrl } : null,
    log: () => {},
  })
  const server = http.createServer(app)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    base: 'http://127.0.0.1:' + port,
    port,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections()
        server.close(() => r())
      }),
  }
}

export interface RawResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

/** Plain http.request so tests can set Host and Origin freely. */
export function raw(
  port: number,
  req: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      { host: '127.0.0.1', port, method: req.method ?? 'GET', path: req.path, headers: req.headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
      },
    )
    r.on('error', reject)
    if (req.body !== undefined) r.write(req.body)
    r.end()
  })
}
