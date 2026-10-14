import fs from 'node:fs'
import path from 'node:path'
import express, { type Express, type Request } from 'express'
import type { Db } from 'mongodb'
import type { ZodTypeAny, output } from 'zod'
import type { Config } from './config.ts'
import { COLLECTIONS, nextScanId } from './db.ts'
import type { EventHub } from './events.ts'
import { HttpError, errorHandler, hostGuard, jsonOnly, originGuard, securityHeaders } from './http/security.ts'
import { cameraParam, idParam, ingestBody, mockBinBody, priceBody, rangeQuery, scanListQuery, settingsBody } from './http/schemas.ts'
import type { BinManager } from './machine/bin-manager.ts'
import { CheckError, type HardwareCheck } from './machine/hardware-check.ts'
import type { InferenceClient } from './machine/inference.ts'
import { Orchestrator, ScanError } from './machine/orchestrator.ts'
import type { RefCache } from './machine/ref-cache.ts'
import { buildScanDocument } from './machine/scan-builder.ts'
import { insertScan } from './machine/scan-store.ts'
import { getDeclaredVariety, setDeclaredVariety } from './machine/settings.ts'
import { dailyClassification, dailySummary, exportRows, latestScan, listScans, scanDetail, toScanRow } from './queries.ts'
import type { DeviceManager } from './serial/device-manager.ts'
import type { MockDevice } from './serial/mock-device.ts'

export interface AppDeps {
  config: Pick<Config, 'host' | 'storageDir' | 'distDir'>
  db: Db
  refs: RefCache
  bins: BinManager
  hub: EventHub
  devices: DeviceManager
  orchestrator: Pick<Orchestrator, 'scan'>
  check: Pick<HardwareCheck, 'preview' | 'sensors'>
  inference: Pick<InferenceClient, 'health'>
  mode: 'serial' | 'mock'
  mock: { controller: MockDevice } | null
  log: (msg: string) => void
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): output<S> {
  const r = schema.safeParse(data)
  if (!r.success) {
    const issue = r.error.issues[0]
    throw new HttpError(400, 'Invalid request: ' + (issue.path.join('.') || 'body') + ' ' + issue.message)
  }
  return r.data
}

const query = (req: Request) => req.query as Record<string, unknown>

export function createApp(deps: AppDeps): Express {
  const { config, db, refs, bins, hub, devices, orchestrator, check, inference, log } = deps
  const app = express()
  app.disable('x-powered-by')

  app.use(securityHeaders())
  app.use(hostGuard(config.host))
  app.use(originGuard())
  app.use(jsonOnly())
  app.use(express.json({ limit: '256kb' }))

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  // ---- reference data -------------------------------------------------------

  const reference = [
    ['varieties', COLLECTIONS.varieties, 'variety_name'],
    ['diseases', COLLECTIONS.diseases, 'disease_name'],
    ['ripeness', COLLECTIONS.ripeness, 'sort_order'],
    ['sizes', COLLECTIONS.sizes, 'sort_order'],
  ] as const
  for (const [route, collection, sortKey] of reference) {
    app.get('/api/reference/' + route, async (_req, res) => {
      res.json(await db.collection(collection).find({}, { projection: { _id: 0 } }).sort({ [sortKey]: 1 }).toArray())
    })
  }

  app.patch('/api/reference/varieties/:id', async (req, res) => {
    const { id } = parse(idParam, req.params)
    const { market_price } = parse(priceBody, req.body)
    const updated = await db
      .collection(COLLECTIONS.varieties)
      .findOneAndUpdate({ variety_id: id }, { $set: { market_price } }, { returnDocument: 'after', projection: { _id: 0 } })
    if (!updated) throw new HttpError(404, 'Variety not found')
    await refs.load()
    res.json(updated)
  })

  // ---- scans -----------------------------------------------------------------

  app.get('/api/scans', async (req, res) => {
    res.json(await listScans(db, refs.get(), parse(scanListQuery, query(req))))
  })

  app.get('/api/scans/latest', async (_req, res) => {
    res.json(await latestScan(db, refs.get()))
  })

  app.get('/api/scans/:id/detail', async (req, res) => {
    const { id } = parse(idParam, req.params)
    const detail = await scanDetail(db, id)
    if (!detail) throw new HttpError(404, 'Scan not found')
    res.json(detail)
  })

  // ---- summaries ---------------------------------------------------------------

  app.get('/api/summary/daily', async (req, res) => {
    const { from, to } = parse(rangeQuery, query(req))
    res.json(await dailySummary(db, from, to))
  })

  app.get('/api/summary/classification', async (req, res) => {
    const { from, to } = parse(rangeQuery, query(req))
    res.json(await dailyClassification(db, refs.get(), from, to))
  })

  app.get('/api/export/scans', async (req, res) => {
    const { from, to } = parse(rangeQuery, query(req))
    res.json(await exportRows(db, from, to))
  })

  // ---- ingest from an outside pipeline ---------------------------------------------

  app.post('/api/scans', async (req, res) => {
    const body = parse(ingestBody, req.body)
    const scanId = await nextScanId(db)
    const now = body.scan_datetime ? new Date(body.scan_datetime) : new Date()
    const doc = buildScanDocument({
      scanId,
      now,
      processingSeconds: body.processing_seconds ?? 0,
      inference: { models: body.models, decision: body.decision, resolved_size: body.resolved_size },
      refs: refs.get(),
      images: (body.images ?? []).map((i) => ({ angle: i.angle, path: i.path, captured_at: now })),
      fullBins: bins.fullSet(),
    })
    if (body.actuation) {
      doc.sorting_log.actuation_status = body.actuation.ok ? 'success' : 'failed'
      doc.sorting_log.latency_ms = body.actuation.latency_ms
    }
    await insertScan(db, hub, doc)
    res.status(201).json({ scan_id: scanId })
  })

  // ---- machine control ------------------------------------------------------------------

  let healthAt = 0
  let health: Promise<{ ok: boolean; detail?: string }> = Promise.resolve({ ok: false })
  const inferenceHealth = () => {
    if (Date.now() - healthAt > 5000) {
      healthAt = Date.now()
      health = inference.health()
    }
    return health
  }

  app.get('/api/machine/status', async (_req, res) => {
    res.json({
      mode: deps.mode,
      devices: devices.status(),
      bins: bins.list(),
      inference: await inferenceHealth(),
      declared_variety: await getDeclaredVariety(db),
    })
  })

  app.post('/api/machine/scan', async (_req, res) => {
    try {
      const doc = await orchestrator.scan('manual')
      res.status(201).json(toScanRow(doc, refs.get()))
    } catch (err) {
      if (err instanceof ScanError) {
        throw new HttpError(err.code === 'BUSY' ? 429 : 409, err.message)
      }
      throw err
    }
  })

  // Look at the hardware without scanning: nothing is stored and no servo moves.
  async function checkHardware<T>(job: () => Promise<T>): Promise<T> {
    try {
      return await job()
    } catch (err) {
      if (err instanceof ScanError) throw new HttpError(429, err.message)
      if (err instanceof CheckError) {
        throw new HttpError(err.code === 'NO_CAMERA' ? 404 : err.code === 'NO_CONTROLLER' ? 409 : 502, err.message)
      }
      throw err
    }
  }

  app.post('/api/machine/preview/:camera', async (req, res) => {
    const { camera } = parse(cameraParam, req.params)
    const jpeg = await checkHardware(() => check.preview(camera))
    res.type('image/jpeg').send(jpeg)
  })

  app.post('/api/machine/sensors', async (_req, res) => {
    res.json({ sensors: await checkHardware(() => check.sensors()) })
  })

  app.put('/api/machine/settings', async (req, res) => {
    const { declared_variety } = parse(settingsBody, req.body)
    if (declared_variety !== null && !refs.get().varieties.some((v) => v.variety_name === declared_variety)) {
      throw new HttpError(400, 'Unknown variety')
    }
    await setDeclaredVariety(db, declared_variety)
    res.json({ declared_variety })
  })

  // Only present when running against the in-process fake ESP32s.
  if (deps.mock) {
    const mock = deps.mock
    app.post('/api/dev/mock/bin', (req, res) => {
      const { bin, full } = parse(mockBinBody, req.body)
      mock.controller.setBinFull(bin, full)
      res.json({ bin, full })
    })
    app.post('/api/dev/mock/mango', (_req, res) => {
      mock.controller.pressMango()
      res.json({ ok: true })
    })
  }

  // ---- live events ---------------------------------------------------------------------------

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    hub.subscribe({
      write: (chunk) => res.write(chunk),
      onClose: (cb) => req.on('close', cb),
    })
  })

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')))

  // ---- files ---------------------------------------------------------------------------------------

  app.use(
    '/images',
    express.static(config.storageDir, {
      index: false,
      dotfiles: 'deny',
      maxAge: '1y',
      immutable: true,
      setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
    }),
  )

  // The built dashboard, when it exists. During development Vite serves it instead.
  if (fs.existsSync(path.join(config.distDir, 'index.html'))) {
    app.use(express.static(config.distDir, { index: false, dotfiles: 'deny' }))
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/images')) {
        next()
        return
      }
      res.sendFile(path.join(config.distDir, 'index.html'))
    })
  }

  app.use(errorHandler(log))
  return app
}
