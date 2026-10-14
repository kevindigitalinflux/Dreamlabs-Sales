import { Hono } from 'hono'
import { secretMatches } from './auth.js'
import { RateLimiter } from './rateLimit.js'
import { safeFetchText, SsrfError, type SafeFetchOptions } from './ssrf.js'

export interface AppDeps {
  /** Overridable in tests. */
  fetchOptions?: SafeFetchOptions
  /** Requests per minute across all callers (the worker is shared, so one global budget). */
  perMinute?: number
}

export function buildApp(secret: string | undefined, deps: AppDeps = {}) {
  const app = new Hono()
  const limiter = new RateLimiter(deps.perMinute ?? 120, 60_000)

  // Every route except the 404 fallback needs the secret header.
  app.use('*', async (c, next) => {
    if (!secretMatches(secret, c.req.header('x-worker-secret'))) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    if (!limiter.take('global')) return c.json({ error: 'rate_limited' }, 429)
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))

  // Guarded page fetch: public http(s) only, size/time/redirect capped. Returns text, never raw errors.
  app.post('/fetch-page', async (c) => {
    const body = await c.req.json().catch(() => null)
    const url = body && typeof body === 'object' && 'url' in body ? (body as { url: unknown }).url : undefined
    if (typeof url !== 'string' || url.length > 2000) return c.json({ error: 'bad_request' }, 400)
    try {
      const r = await safeFetchText(url, deps.fetchOptions)
      return c.json({ final_url: r.finalUrl, status: r.status, content_type: r.contentType, truncated: r.truncated, body: r.body })
    } catch (e) {
      const code = e instanceof SsrfError ? e.code : 'fetch_failed'
      return c.json({ error: code }, code === 'timeout' ? 504 : 422)
    }
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
