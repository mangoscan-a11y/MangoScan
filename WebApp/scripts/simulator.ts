/**
 * MangoScan scan simulator.
 *
 * Posts made-up scans to the local server, standing in for the ESP32 and the
 * models. Handy for filling the dashboard while no hardware is attached.
 *
 *   npm run simulator                 one scan every 5 seconds
 *   npm run simulator -- --interval=1000 --count=50
 *
 * The server must be running (npm run server). Set API_URL if it is elsewhere.
 */
import { randomOptions, simulateInference } from '../server/dev/simulate.ts'

try {
  process.loadEnvFile('.env')
} catch {
  // no .env, defaults apply
}

const base = (process.env.API_URL ?? 'http://127.0.0.1:' + (process.env.PORT ?? '4000')).replace(/\/+$/, '')

function flag(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith('--' + name + '='))
  const n = arg ? Number(arg.split('=')[1]) : fallback
  if (!Number.isFinite(n) || n < 0) {
    console.error('--' + name + ' must be a non-negative number')
    process.exit(1)
  }
  return n
}

const intervalMs = Math.max(100, flag('interval', 5000))
const limit = flag('count', 0)

async function currentBatchVariety(): Promise<string | null> {
  try {
    const res = await fetch(base + '/api/machine/status')
    const status = (await res.json()) as { declared_variety: string | null }
    return status.declared_variety
  } catch {
    return null
  }
}

let sent = 0

async function sendOne(): Promise<void> {
  const declared = await currentBatchVariety()
  const options = randomOptions(Math.random, declared)
  const inference = simulateInference(0, options)
  const started = Date.now()

  const res = await fetch(base + '/api/scans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...inference,
      processing_seconds: Math.round((1.2 + Math.random() * 2.6) * 100) / 100,
      actuation: { ok: true, latency_ms: 80 + Math.floor(Math.random() * 120) },
    }),
  })
  if (!res.ok) {
    console.error('Server refused the scan (HTTP ' + res.status + '): ' + (await res.text()))
    return
  }
  const { scan_id } = (await res.json()) as { scan_id: number }
  sent++
  const d = inference.decision
  console.log(
    '[' + new Date().toLocaleTimeString() + '] Scan #' + scan_id + '  ' + d.quality_verdict.toUpperCase().padEnd(8) +
      d.bin_name.padEnd(16) + (options.variety ?? '') + ' / ' + (options.disease ?? '') + (options.bruised ? ' / bruised' : '') +
      '  (' + (Date.now() - started) + ' ms)',
  )
}

async function main() {
  console.log('Simulator sending to ' + base + ' every ' + intervalMs / 1000 + ' s. Ctrl+C to stop.')
  try {
    await fetch(base + '/api/health')
  } catch {
    console.error('Cannot reach the server at ' + base + '. Start it first with: npm run server')
    process.exit(1)
  }
  for (;;) {
    await sendOne().catch((err) => console.error('Failed to send a scan: ' + (err instanceof Error ? err.message : String(err))))
    if (limit > 0 && sent >= limit) break
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

void main()
