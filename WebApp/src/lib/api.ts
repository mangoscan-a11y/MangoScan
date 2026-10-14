/**
 * Client for the local MangoScan server. Everything is same-origin: in
 * production the server also serves this app, and in development Vite
 * forwards /api and /images to it.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type Params = Record<string, string | number | boolean | null | undefined>

function toQuery(params?: Params): string {
  if (!params) return ''
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    q.set(key, String(value))
  }
  const s = q.toString()
  return s ? '?' + s : ''
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the MangoScan server. Is it running?')
  }

  if (!res.ok) {
    let message = 'Request failed (HTTP ' + res.status + ')'
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string') message = body.error
    } catch {
      // body was not JSON, keep the generic message
    }
    throw new ApiError(res.status, message)
  }

  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

export function apiGet<T>(path: string, params?: Params): Promise<T> {
  return request<T>(path + toQuery(params), { method: 'GET' })
}

export function apiSend<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (body === undefined) return request<T>(path, { method })
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Where a captured image is served from. Paths come from the server and are relative. */
export function imageUrl(path: string): string {
  return '/images/' + path.split('/').map(encodeURIComponent).join('/')
}
