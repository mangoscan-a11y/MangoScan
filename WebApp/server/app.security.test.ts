// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mongoAvailable } from './test/mongo.ts'
import { createHarness, type Harness } from './test/harness.ts'
import { raw, startApp, type RunningApp } from './test/http.ts'

const hasMongo = await mongoAvailable()
const json = { 'content-type': 'application/json' }

describe.skipIf(!hasMongo)('HTTP security', () => {
  let h: Harness
  let app: RunningApp

  beforeAll(async () => {
    h = await createHarness()
    app = await startApp(h)
  })
  afterAll(async () => {
    await app.close()
    await h.close()
  })

  it('sets protective headers and hides the framework', async () => {
    const r = await raw(app.port, { path: '/api/health' })
    expect(r.status).toBe(200)
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(r.headers['content-security-policy']).toContain("default-src 'none'")
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(r.headers['x-powered-by']).toBeUndefined()
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('rejects a Host header that is not local while bound to loopback', async () => {
    const r = await raw(app.port, { path: '/api/health', headers: { host: 'evil.example' } })
    expect(r.status).toBe(403)
  })

  it('accepts the localhost spellings', async () => {
    for (const host of ['localhost:4000', '127.0.0.1:5173', '[::1]:4000']) {
      expect((await raw(app.port, { path: '/api/health', headers: { host } })).status).toBe(200)
    }
  })

  it('blocks cross-site writes but allows same-origin and header-less clients', async () => {
    const post = (origin?: string) =>
      raw(app.port, {
        method: 'PUT',
        path: '/api/machine/settings',
        headers: { ...json, host: 'localhost:4000', ...(origin ? { origin } : {}) },
        body: JSON.stringify({ declared_variety: null }),
      })
    expect((await post('http://evil.example')).status).toBe(403)
    expect((await post('null')).status).toBe(403)
    expect((await post('http://localhost:4000')).status).toBe(200)
    expect((await post()).status).toBe(200)
  })

  it('requires application/json for request bodies', async () => {
    const r = await raw(app.port, {
      method: 'PUT',
      path: '/api/machine/settings',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ declared_variety: null }),
    })
    expect(r.status).toBe(415)
  })

  it('refuses oversized bodies', async () => {
    const r = await raw(app.port, {
      method: 'PUT',
      path: '/api/machine/settings',
      headers: json,
      body: JSON.stringify({ declared_variety: 'x'.repeat(400_000) }),
    })
    expect(r.status).toBe(413)
  })

  it('does not let a client change fields it should not (mass assignment)', async () => {
    const r = await raw(app.port, {
      method: 'PATCH',
      path: '/api/reference/varieties/1',
      headers: json,
      body: JSON.stringify({ market_price: 10, variety_name: 'Hacked' }),
    })
    expect(r.status).toBe(400)
    const after = JSON.parse((await raw(app.port, { path: '/api/reference/varieties' })).body)
    expect(after.find((v: { variety_id: number }) => v.variety_id === 1).variety_name).toBe('Carabao')
  })

  it('rejects query operators smuggled into filters', async () => {
    for (const q of ['varietyId[$ne]=1', 'verdict[$ne]=passed', 'page=0', 'pageSize=5000', 'bruised=maybe', 'dateFrom=2026-13-45']) {
      const r = await raw(app.port, { path: '/api/scans?' + q })
      expect(r.status, q).toBe(400)
    }
  })


  it('does not serve files outside the image folder', async () => {
    for (const p of ['/images/../package.json', '/images/%2e%2e/package.json', '/images/..%5cpackage.json']) {
      const r = await raw(app.port, { path: p })
      expect([400, 403, 404], p).toContain(r.status)
      expect(r.body).not.toContain('mangoscan-web')
    }
  })

  it('answers unexpected failures with a generic message and no internals', async () => {
    const original = h.refs.get.bind(h.refs)
    h.refs.get = () => {
      throw new Error('secret detail in C:/private/file.ts')
    }
    try {
      const r = await raw(app.port, { path: '/api/scans/latest' })
      expect(r.status).toBe(500)
      expect(JSON.parse(r.body)).toEqual({ error: 'Internal error' })
    } finally {
      h.refs.get = original
    }
  })

  it('rejects a malformed scan id', async () => {
    expect((await raw(app.port, { path: '/api/scans/abc/detail' })).status).toBe(400)
  })
})
