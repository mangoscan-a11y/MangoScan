import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiBlob, apiGet, apiSend } from '@/lib/api'

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiGet', () => {
  it('requests the path with only the parameters that have a value', async () => {
    const fetchMock = respond(200, { ok: true })
    await apiGet('/api/scans', { page: 2, verdict: 'passed', varietyId: undefined, bruised: '', x: null, flag: false })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/scans?page=2&verdict=passed&flag=false')
  })

  it('returns the parsed JSON body', async () => {
    respond(200, { data: [1, 2], count: 2 })
    expect(await apiGet('/api/scans')).toEqual({ data: [1, 2], count: 2 })
  })

  it('encodes values so a filter cannot break out of its parameter', async () => {
    const fetchMock = respond(200, [])
    await apiGet('/api/x', { q: 'a&b=c d' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/x?q=a%26b%3Dc+d')
  })

  it('turns a server error into an ApiError carrying the server message', async () => {
    respond(400, { error: 'Invalid request: page must be positive' })
    const err = await apiGet('/api/scans').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'Invalid request: page must be positive' })
  })

  it('falls back to the status when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 502 })))
    await expect(apiGet('/api/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (HTTP 502)' })
  })

  it('explains when the server cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(apiGet('/api/x')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/server/i) })
  })
})

describe('apiSend', () => {
  it('sends JSON with the right method and header', async () => {
    const fetchMock = respond(200, { market_price: 5 })
    await apiSend('PATCH', '/api/reference/varieties/1', { market_price: 5 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/reference/varieties/1')
    expect(init.method).toBe('PATCH')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe('{"market_price":5}')
  })

  it('omits the body and content type when there is nothing to send', async () => {
    const fetchMock = respond(201, { scan_id: 1 })
    await apiSend('POST', '/api/machine/scan')
    const init = fetchMock.mock.calls[0][1]
    expect(init.body).toBeUndefined()
    expect(init.headers?.['Content-Type']).toBeUndefined()
  })
})

describe('apiBlob', () => {
  it('posts without a body and returns the bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const blob = await apiBlob('POST', '/api/machine/preview/cam-1')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/machine/preview/cam-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
  })

  it('turns a server error into an ApiError carrying the server message', async () => {
    respond(502, { error: 'The camera did not deliver a photo' })
    await expect(apiBlob('POST', '/api/machine/preview/cam-1')).rejects.toMatchObject({
      status: 502,
      message: 'The camera did not deliver a photo',
    })
  })
})
