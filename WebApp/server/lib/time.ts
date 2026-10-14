/** The factory runs on Philippine time (UTC+8, no DST) and so do the daily summaries. */
const MANILA_TZ = 'Asia/Manila'
const DAY_MS = 24 * 3600 * 1000

const manilaDateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: MANILA_TZ })

export function manilaDateString(date: Date): string {
  return manilaDateFormat.format(date)
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value)
}

/** Inclusive `from`..`to` calendar dates (Manila) as a half-open UTC instant range. */
export function manilaDayRange(from: string, to: string): { gte: Date; lt: Date } {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new RangeError('dates must be yyyy-MM-dd')
  const gte = new Date(`${from}T00:00:00+08:00`)
  const lt = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + DAY_MS)
  return { gte, lt }
}
