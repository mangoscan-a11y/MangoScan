// @vitest-environment node
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mongoAvailable } from './test/mongo.ts'
import { createHarness, greenMedium, type Harness } from './test/harness.ts'
import { raw, startApp, type RunningApp } from './test/http.ts'
import { waitFor } from './test/helpers.ts'

const hasMongo = await mongoAvailable()
const json = { 'content-type': 'application/json' }

describe.skipIf(!hasMongo)('HTTP routes', () => {
  let h: Harness
  let app: RunningApp
  const get = async (p: string) => {
    const r = await raw(app.port, { path: p })
    return { status: r.status, body: r.body ? JSON.parse(r.body) : null }
  }
  const send = async (method: string, p: string, body?: unknown) => {
    const r = await raw(app.port, { method, path: p, headers: json, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: r.body ? JSON.parse(r.body) : null }
  }

  beforeAll(async () => {
    h = await createHarness()
    app = await startApp(h, { mock: true })
  })
  afterAll(async () => {
    await app.close()
    await h.close()
  })

  it('reports health', async () => {
    expect(await get('/api/health')).toEqual({ status: 200, body: { ok: true } })
  })

  it('lists reference data in the order the UI expects', async () => {
    const v = await get('/api/reference/varieties')
    expect(v.body.map((x: { variety_name: string }) => x.variety_name)).toEqual(['Apple Mango', 'Carabao', 'Chupadera', 'Indian', 'Kabayo', 'Wani'])
    expect((await get('/api/reference/ripeness')).body.map((x: { ripeness_name: string }) => x.ripeness_name)).toEqual(['Green', 'Yellow'])
    expect((await get('/api/reference/sizes')).body).toHaveLength(3)
    expect((await get('/api/reference/diseases')).body).toHaveLength(3)
  })

  it('updates a market price and refreshes what scans show', async () => {
    const r = await send('PATCH', '/api/reference/varieties/1', { market_price: 135.5 })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ variety_id: 1, market_price: 135.5 })
    expect((await get('/api/reference/varieties')).body.find((x: { variety_id: number }) => x.variety_id === 1).market_price).toBe(135.5)
  })

  it('validates market price edits', async () => {
    expect((await send('PATCH', '/api/reference/varieties/1', { market_price: -1 })).status).toBe(400)
    expect((await send('PATCH', '/api/reference/varieties/1', { market_price: 'cheap' })).status).toBe(400)
    expect((await send('PATCH', '/api/reference/varieties/abc', { market_price: 1 })).status).toBe(400)
    expect((await send('PATCH', '/api/reference/varieties/99', { market_price: 1 })).status).toBe(404)
  })

  it('has no latest scan and no history on a fresh database', async () => {
    expect(await get('/api/scans/latest')).toEqual({ status: 200, body: null })
    expect((await get('/api/scans')).body).toEqual({ data: [], count: 0 })
  })

  it('runs a scan on demand and shows it everywhere', async () => {
    const r = await send('POST', '/api/machine/scan')
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ bin_assigned: 'GREEN_MEDIUM', quality_verdict: 'passed' })
    const id = r.body.scan_id

    const list = await get('/api/scans?verdict=passed&page=1&pageSize=15')
    expect(list.body.count).toBe(1)
    expect(list.body.data[0]).toMatchObject({ scan_id: id, mango_varieties: { variety_name: 'Carabao', market_price: 135.5 } })
    expect((await get('/api/scans/latest')).body.scan_id).toBe(id)

    const detail = await get('/api/scans/' + id + '/detail')
    expect(detail.body.images).toHaveLength(5)
    expect(detail.body.detections).toHaveLength(5)
    expect(detail.body.log.gate_target).toBe('GREEN_MEDIUM')
    expect((await get('/api/scans/9999/detail')).status).toBe(404)
  })

  it('serves captured images with a safe content type', async () => {
    const id = (await get('/api/scans/latest')).body.scan_id
    const detail = await get('/api/scans/' + id + '/detail')
    const img = await raw(app.port, { path: '/images/' + detail.body.images[0].image_path })
    expect(img.status).toBe(200)
    expect(img.headers['content-type']).toBe('image/jpeg')
    expect(img.headers['x-content-type-options']).toBe('nosniff')
  })

  it('summarizes the day and exports a CSV-ready list', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
    const daily = await get('/api/summary/daily?from=' + today + '&to=' + today)
    expect(daily.body[0]).toMatchObject({ summary_date: today, total_scanned: 1, total_passed: 1 })
    const cls = await get('/api/summary/classification?from=' + today + '&to=' + today)
    expect(cls.body.filter((r: { dimension: string }) => r.dimension === 'size')).toEqual([
      { summary_date: today, dimension: 'size', label: 'Medium', count: 1, sort_order: 2 },
    ])
    const exp = await get('/api/export/scans?from=' + today + '&to=' + today)
    expect(exp.body).toHaveLength(1)
    expect((await get('/api/summary/daily?from=nope&to=' + today)).status).toBe(400)
  })

  it('reports devices, bins and the batch variety', async () => {
    const s = await get('/api/machine/status')
    expect(s.body.mode).toBe('mock')
    expect(s.body.devices.map((d: { id: string }) => d.id)).toEqual(['cam-1', 'ctrl-1'])
    expect(s.body.bins).toHaveLength(8)
    expect(s.body.inference.ok).toBe(true)
  })

  it('sets the declared batch variety, only to a real variety', async () => {
    expect((await send('PUT', '/api/machine/settings', { declared_variety: 'Wani' })).body).toEqual({ declared_variety: 'Wani' })
    expect((await get('/api/machine/status')).body.declared_variety).toBe('Wani')
    expect((await send('PUT', '/api/machine/settings', { declared_variety: 'Banana' })).status).toBe(400)
    expect((await send('PUT', '/api/machine/settings', { declared_variety: null })).body).toEqual({ declared_variety: null })
  })

  it('lets the mock controller fill a bin so the alert flow can be demonstrated', async () => {
    expect((await send('POST', '/api/dev/mock/bin', { bin: 3, full: true })).status).toBe(200)
    await waitFor(() => h.bins.fullSet().has(3), 2000, 'bin 3 full')
    expect((await get('/api/machine/status')).body.bins[2].full).toBe(true)
    expect((await send('POST', '/api/dev/mock/bin', { bin: 11, full: true })).status).toBe(400)
  })

  it('ingests a scan posted by an outside pipeline', async () => {
    const result = greenMedium('ignored', null)
    const r = await send('POST', '/api/scans', { ...result, processing_seconds: 0.8 })
    expect(r.status).toBe(201)
    const row = (await get('/api/scans/latest')).body
    expect(row.scan_id).toBe(r.body.scan_id)
    expect(row.processing_time).toBe(0.8)
  })

  it('refuses ingest that is malformed or points outside the image folder', async () => {
    const good = greenMedium('x', null)
    expect((await send('POST', '/api/scans', { models: {} })).status).toBe(400)
    const evil = { ...good, images: [{ angle: 1, path: '../../etc/passwd' }] }
    expect((await send('POST', '/api/scans', evil)).status).toBe(400)
  })

  it('streams live events', async () => {
    const chunks: string[] = []
    const req = http.get({ host: '127.0.0.1', port: app.port, path: '/api/events' }, (res) => {
      expect(res.headers['content-type']).toContain('text/event-stream')
      res.on('data', (c) => chunks.push(String(c)))
    })
    await waitFor(() => chunks.join('').includes('retry: 2000'), 2000, 'stream open')
    await send('POST', '/api/machine/scan')
    await waitFor(() => chunks.join('').includes('event: scan.created'), 3000, 'scan event')
    req.destroy()
  })

  it('keeps the mock controls out of a real deployment', async () => {
    const real = await startApp(h, { mock: false })
    const r = await raw(real.port, { method: 'POST', path: '/api/dev/mock/bin', headers: json, body: '{"bin":1,"full":true}' })
    expect(r.status).toBe(404)
    await real.close()
  })
})
