// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BINS, randomOptions, simulateInference } from './simulate.ts'

const decide = (o: Parameters<typeof simulateInference>[1]) => simulateInference(1, o).decision

describe('simulateInference', () => {
  it('routes healthy unbruised fruit by color and size into bins 3 to 8', () => {
    expect(decide({ color: 'Green', size: 'Small' })).toMatchObject({ bin_index: 3, bin_name: 'GREEN_SMALL', quality_verdict: 'passed' })
    expect(decide({ color: 'Yellow', size: 'Small' }).bin_index).toBe(4)
    expect(decide({ color: 'Green', size: 'Medium' }).bin_index).toBe(5)
    expect(decide({ color: 'Yellow', size: 'Medium' }).bin_index).toBe(6)
    expect(decide({ color: 'Green', size: 'Large' }).bin_index).toBe(7)
    expect(decide({ color: 'Yellow', size: 'Large' }).bin_index).toBe(8)
  })

  it('rejects disease into bin 1 and bruises into bin 2, disease first', () => {
    expect(decide({ disease: 'Anthracnose' })).toMatchObject({ bin_index: 1, quality_verdict: 'rejected', reason_code: 'DISEASE_DETECTED' })
    expect(decide({ bruised: true })).toMatchObject({ bin_index: 2, reason_code: 'BRUISE_DETECTED' })
    expect(decide({ disease: 'Mango Scab', bruised: true }).bin_index).toBe(1)
  })

  it('raises a variety mismatch alert without changing the bin', () => {
    const d = decide({ variety: 'Wani', declared: 'Carabao', color: 'Green', size: 'Medium' })
    expect(d.alerts).toContain('VARIETY_MISMATCH')
    expect(d.variety_match).toBe(false)
    expect(d.bin_index).toBe(5)
  })

  it('has eight bins that agree with the routing table', () => {
    expect(BINS.map((b) => b.name)).toEqual([
      'REJECT_DISEASED', 'REJECT_BRUISED', 'GREEN_SMALL', 'YELLOW_SMALL', 'GREEN_MEDIUM', 'YELLOW_MEDIUM',
      'GREEN_LARGE', 'YELLOW_LARGE',
    ])
  })

  it('generates only labels the reference tables know', () => {
    let n = 0
    const rng = () => ((n = (n * 9301 + 49297) % 233280), n / 233280)
    for (let i = 0; i < 200; i++) {
      const o = randomOptions(rng, 'Carabao')
      expect(['Green', 'Yellow']).toContain(o.color)
      expect(['Small', 'Medium', 'Large']).toContain(o.size)
    }
  })
})
