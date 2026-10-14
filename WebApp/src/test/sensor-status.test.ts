import { describe, expect, it } from 'vitest'
import { describeSensor, installedSensors, missingSensorsNote } from '@/features/machine/sensor-status'
import type { SensorReading } from '@/lib/database.types'

function readings(over: Record<number, Partial<SensorReading>> = {}): SensorReading[] {
  return Array.from({ length: 8 }, (_, i) => ({ bin: i + 1, state: 'absent' as const, cm: null, ...over[i + 1] }))
}

describe('describeSensor', () => {
  it('calls a sensor that measured a distance working', () => {
    expect(describeSensor({ bin: 1, state: 'ok', cm: 23 })).toEqual({ ok: true, label: 'Working', value: '23 cm' })
  })

  it('points at the wiring when a sensor hears no echo', () => {
    const d = describeSensor({ bin: 1, state: 'no_echo', cm: null })
    expect(d.ok).toBe(false)
    expect(d.value).toBe('No echo')
    expect(d.label).toMatch(/wiring|power|object/i)
  })
})

describe('installedSensors', () => {
  it('keeps only bins that have a sensor', () => {
    const list = readings({ 1: { state: 'ok', cm: 20 }, 4: { state: 'no_echo' } })
    expect(installedSensors(list).map((r) => r.bin)).toEqual([1, 4])
  })
})

describe('missingSensorsNote', () => {
  it('summarises a run of bins as a range', () => {
    expect(missingSensorsNote(readings({ 1: { state: 'ok', cm: 20 } }))).toBe('Bins 2-8 have no sensor installed.')
  })

  it('lists separate bins one by one', () => {
    const over: Record<number, Partial<SensorReading>> = {}
    for (const b of [1, 3, 4, 6, 7, 8]) over[b] = { state: 'ok', cm: 10 }
    expect(missingSensorsNote(readings(over))).toBe('Bins 2, 5 have no sensor installed.')
  })

  it('uses the singular for one bin', () => {
    const over: Record<number, Partial<SensorReading>> = {}
    for (let b = 1; b <= 8; b++) if (b !== 4) over[b] = { state: 'ok', cm: 10 }
    expect(missingSensorsNote(readings(over))).toBe('Bin 4 has no sensor installed.')
  })

  it('says nothing when every bin has a sensor', () => {
    const over: Record<number, Partial<SensorReading>> = {}
    for (let b = 1; b <= 8; b++) over[b] = { state: 'ok', cm: 10 }
    expect(missingSensorsNote(readings(over))).toBeNull()
  })

  it('says every bin is missing a sensor when none is installed', () => {
    expect(missingSensorsNote(readings())).toBe('Bins 1-8 have no sensor installed.')
  })
})
