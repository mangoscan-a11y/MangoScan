import { z } from 'zod'
import { isIsoDate } from '../lib/time.ts'
import { resultSchema } from '../machine/inference.ts'

const id = z.coerce.number().int().positive().max(1_000_000)
const isoDate = z.string().refine(isIsoDate, 'must be yyyy-MM-dd')

export const idParam = z.object({ id }).strict()

export const scanListQuery = z
  .object({
    verdict: z.enum(['passed', 'rejected']).optional(),
    varietyId: id.optional(),
    diseaseId: id.optional(),
    ripenessId: id.optional(),
    sizeId: id.optional(),
    bruised: z.enum(['true', 'false']).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(15),
  })
  .strict()

export const rangeQuery = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((q) => q.from <= q.to, 'from must not be after to')
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= 366, 'range too long')

export const priceBody = z.object({ market_price: z.number().min(0).max(100_000) }).strict()

export const settingsBody = z.object({ declared_variety: z.string().min(1).max(64).nullable() }).strict()

// Same shape a board may use for its id in its hello message.
export const cameraParam = z.object({ camera: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/) }).strict()

export const mockBinBody = z.object({ bin: z.number().int().min(1).max(8), full: z.boolean() }).strict()

export const ingestBody = resultSchema.extend({
  processing_seconds: z.number().min(0).max(600).optional(),
  scan_datetime: z.string().datetime().optional(),
  images: z
    .array(
      z.object({
        angle: z.number().int().min(1).max(9),
        // Only files this server wrote itself can be referenced.
        path: z.string().regex(/^scan-images\/\d{1,9}\/angle-[1-9]\.jpg$/),
      }),
    )
    .max(9)
    .optional(),
  actuation: z.object({ ok: z.boolean(), latency_ms: z.number().min(0).max(60_000).nullable() }).optional(),
})
