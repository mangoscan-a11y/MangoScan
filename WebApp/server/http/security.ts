import type { ErrorRequestHandler, RequestHandler } from 'express'

export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

// Everything the dashboard loads comes from this server, so the policy is tight.
// style-src allows inline because React and Radix set style attributes.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export function securityHeaders(): RequestHandler {
  return (req, res, next) => {
    res.removeHeader('X-Powered-By')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', CSP)
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store')
    next()
  }
}

const LOOPBACK_BINDS = new Set(['127.0.0.1', 'localhost', '::1'])
const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '::1'])

function hostname(hostHeader: string): string {
  if (hostHeader.startsWith('[')) return hostHeader.slice(1, hostHeader.indexOf(']'))
  return hostHeader.split(':')[0]
}

/**
 * When the server is only meant for this laptop, refuse requests addressed to any other
 * name. That stops a malicious web page from reaching it through DNS rebinding.
 */
export function hostGuard(bindHost: string): RequestHandler {
  if (!LOOPBACK_BINDS.has(bindHost)) return (_req, _res, next) => next()
  return (req, res, next) => {
    const host = req.headers.host
    if (!host || !LOCAL_NAMES.has(hostname(host).toLowerCase())) {
      res.status(403).json({ error: 'Forbidden host' })
      return
    }
    next()
  }
}

/** A browser always sends Origin on cross-site writes. Anything not from this very site is refused. */
export function originGuard(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next()
      return
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      let sameSite = false
      try {
        sameSite = new URL(origin).host === req.headers.host
      } catch {
        sameSite = false
      }
      if (!sameSite) {
        res.status(403).json({ error: 'Cross-origin request blocked' })
        return
      }
    }
    next()
  }
}

/** Writes must be JSON. A cross-site form or text/plain post cannot be, so it never reaches a handler. */
export function jsonOnly(): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next()
      return
    }
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined
    if (hasBody && !String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json' })
      return
    }
    next()
  }
}

export function errorHandler(log: (msg: string) => void): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) {
      next(err)
      return
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message })
      return
    }
    const status = typeof err?.status === 'number' ? err.status : 0
    if (status === 413) {
      res.status(413).json({ error: 'Payload too large' })
      return
    }
    if (status >= 400 && status < 500) {
      res.status(400).json({ error: 'Bad request' })
      return
    }
    log('unhandled error: ' + (err instanceof Error ? (err.stack ?? err.message) : String(err)))
    res.status(500).json({ error: 'Internal error' })
  }
}
