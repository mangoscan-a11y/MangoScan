import type { SensorReading } from '@/lib/database.types'

export interface SensorDescription {
  ok: boolean
  label: string
  value: string
}

export function describeSensor(r: SensorReading): SensorDescription {
  if (r.state === 'ok' && r.cm !== null) return { ok: true, label: 'Working', value: r.cm + ' cm' }
  return { ok: false, label: 'Nothing heard back: check power, wiring, or put an object in front', value: 'No echo' }
}

export function installedSensors(readings: SensorReading[]): SensorReading[] {
  return readings.filter((r) => r.state !== 'absent')
}

/** "Bins 2-8 have no sensor installed.", or null when every bin has one. */
export function missingSensorsNote(readings: SensorReading[]): string | null {
  const missing = readings.filter((r) => r.state === 'absent').map((r) => r.bin)
  if (missing.length === 0) return null
  if (missing.length === 1) return 'Bin ' + missing[0] + ' has no sensor installed.'
  const first = missing[0]
  const last = missing[missing.length - 1]
  const isRun = last - first === missing.length - 1
  return 'Bins ' + (isRun ? first + '-' + last : missing.join(', ')) + ' have no sensor installed.'
}
