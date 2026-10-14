import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fallbackInference } from './inference.ts'
import { BINS } from '../dev/simulate.ts'

// MyTasks/model5_fusion/config/routing.toml decides which number each bin has. The server
// fallback, the dev simulator and the dashboard labels each keep a hand-written copy, so this
// test fails the moment one of them drifts from the routing table. MyTasks is not in git, so
// the whole file is skipped on a checkout that does not have it.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTING = path.resolve(HERE, '../../../MyTasks/model5_fusion/config/routing.toml')
// The dashboard lives in a separate TypeScript project, so its label table is read as text.
const DASHBOARD_LABELS = path.resolve(HERE, '../../src/features/bins/bin-alerts.ts')

function readDashboardNames(): Record<number, string> {
  const source = fs.readFileSync(DASHBOARD_LABELS, 'utf8')
  const table = /const NAMES[^{]*\{([\s\S]*?)\n\}/.exec(source)
  if (!table) throw new Error('bin-alerts.ts: NAMES table not found')
  return Object.fromEntries([...table[1].matchAll(/(\d+): '([^']+)'/g)].map((m) => [Number(m[1]), m[2]]))
}

interface RoutedBin {
  index: number
  name: string
  verdict: string
  s1: string
  s2: string
}

function field(block: string, key: string): string {
  const match = new RegExp('^' + key + ' = (.+)$', 'm').exec(block)
  if (!match) throw new Error('routing.toml: missing ' + key)
  return match[1].trim().replace(/^"|"$/g, '')
}

function readRouting(): { bins: RoutedBin[]; lowConfidenceBin: number } {
  const [header, ...blocks] = fs.readFileSync(ROUTING, 'utf8').split(/^\[\[bins\]\]\s*$/m)
  const bins = blocks.map((b) => ({
    index: Number(field(b, 'index')),
    name: field(b, 'name'),
    verdict: field(b, 'verdict'),
    s1: field(b, 'servo1_action'),
    s2: field(b, 'servo2_action'),
  }))
  const low = /\[low_confidence\][\s\S]*?^bin_index = (\d+)/m.exec(header)
  if (!low) throw new Error('routing.toml: missing low_confidence.bin_index')
  return { bins: bins.sort((a, b) => a.index - b.index), lowConfidenceBin: Number(low[1]) }
}

/** "GREEN_SMALL" -> "Green Small"; the two reject bins are shown as "Diseased" and "Bruised". */
function displayName(binName: string): string {
  return binName
    .replace(/^REJECT_/, '')
    .split('_')
    .map((w) => w[0] + w.slice(1).toLowerCase())
    .join(' ')
}

describe.skipIf(!fs.existsSync(ROUTING))('bin numbering agrees with routing.toml', () => {
  const routing = fs.existsSync(ROUTING) ? readRouting() : { bins: [], lowConfidenceBin: 0 }

  it('has eight bins numbered 1 to 8', () => {
    expect(routing.bins.map((b) => b.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('the failsafe sends unclassifiable fruit to the same reject bin Model 5 uses', () => {
    const target = routing.bins.find((b) => b.index === routing.lowConfidenceBin)
    expect(target?.verdict).toBe('rejected')
    const { decision } = fallbackInference(1, null, 'INFERENCE_UNAVAILABLE')
    expect(decision).toMatchObject({
      bin_index: target?.index,
      bin_name: target?.name,
      quality_verdict: 'rejected',
      servo1_action: target?.s1,
      servo2_action: target?.s2,
    })
  })

  it('the dev simulator has the same bin table', () => {
    expect(BINS.map((b) => ({ index: b.index, name: b.name, verdict: b.verdict, s1: b.s1, s2: b.s2 }))).toEqual(
      routing.bins,
    )
  })

  it('the dashboard labels every bin with its routed name', () => {
    const names = readDashboardNames()
    expect(Object.keys(names)).toHaveLength(routing.bins.length)
    for (const b of routing.bins) expect(names[b.index]).toBe(displayName(b.name))
  })
})
