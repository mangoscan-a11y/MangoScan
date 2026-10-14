// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isIsoDate, manilaDateString, manilaDayRange } from './time.ts'

describe('Manila time helpers', () => {
  it('formats an instant as its Asia/Manila calendar date', () => {
    expect(manilaDateString(new Date('2026-10-13T16:30:00Z'))).toBe('2026-10-14')
    expect(manilaDateString(new Date('2026-10-13T15:59:59Z'))).toBe('2026-10-13')
  })

  it('turns an inclusive date range into [gte, lt) UTC instants at Manila midnight', () => {
    const r = manilaDayRange('2026-10-14', '2026-10-15')
    expect(r.gte.toISOString()).toBe('2026-10-13T16:00:00.000Z')
    expect(r.lt.toISOString()).toBe('2026-10-15T16:00:00.000Z')
  })

  it('a single day is one 24h window', () => {
    const r = manilaDayRange('2026-10-14', '2026-10-14')
    expect(r.lt.getTime() - r.gte.getTime()).toBe(24 * 3600 * 1000)
  })

  it('validates yyyy-MM-dd strictly, including real calendar dates', () => {
    expect(isIsoDate('2026-10-14')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-1-4')).toBe(false)
    expect(isIsoDate('2026-10-14T00:00:00Z')).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})
