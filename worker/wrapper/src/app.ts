import { Hono } from 'hono'
import { secretMatches } from './auth.js'
import { RateLimiter } from './rateLimit.js'
import { safeFetchText, SsrfError, type SafeFetchOptions } from './ssrf.js'
import { makeDomainThrottle, normaliseEmail, type VerifyResult } from './verifyEmail.js'
import { ScrapeError, toMode, toScrapeTarget, type ScrapeMode } from './scrapeSite.js'

export interface AppDeps {
  /** Site scraper (Chrome-backed); the server wires it in, tests pass a fake. Absent = route answers 503. */
  scrape?: (url: string, mode: ScrapeMode) => Promise<Record<string, unknown>>
  /** Overridable in tests. */
  fetchOptions?: SafeFetchOptions
  /** Requests per minute across all callers (the worker is shared, so one global budget). */
  perMinute?: number
  /** Email checker; the server wires Reacher in, tests pass a fake. Absent = route answers 503. */
  verify?: (email: string) => Promise<VerifyResult>
  /** Checks per minute per mail domain. */
  perDomainPerMinute?: number
  /** Site scrapes per minute across all callers. */
  scrapePerMinute?: number
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

  const domainThrottle = makeDomainThrottle(deps.perDomainPerMinute ?? 5)

  // Mailbox check through Reacher. Answers only valid / invalid / risky / unverifiable plus a fixed reason code.
  app.post('/verify-email', async (c) => {
    if (!deps.verify) return c.json({ error: 'not_configured' }, 503)
    const body = await c.req.json().catch(() => null)
    const parsed = normaliseEmail(body && typeof body === 'object' ? (body as { email?: unknown }).email : undefined)
    if (!parsed) return c.json({ error: 'bad_request' }, 400)
    if (!domainThrottle.take(parsed.domain)) return c.json({ error: 'domain_throttled' }, 429)
    return c.json(await deps.verify(parsed.email))
  })

  // Contact scrape of one company website (emails, phones, socials, tech). Heavy, so it has its own tight budget.
  const scrapeLimiter = new RateLimiter(deps.scrapePerMinute ?? 6, 60_000)
  app.post('/scrape-site', async (c) => {
    if (!deps.scrape) return c.json({ error: 'not_configured' }, 503)
    const body = await c.req.json().catch(() => null)
    const input = body && typeof body === 'object' ? (body as { url?: unknown; mode?: unknown }) : {}
    const mode = toMode(input.mode)
    if (!mode) return c.json({ error: 'bad_request' }, 400)
    let target: string
    try {
      target = toScrapeTarget(input.url)
    } catch (e) {
      return c.json({ error: e instanceof SsrfError ? e.code : 'bad_url' }, 422)
    }
    if (!scrapeLimiter.take('scrape')) return c.json({ error: 'rate_limited' }, 429)
    try {
      return c.json(await deps.scrape(target, mode))
    } catch (e) {
      const code = e instanceof ScrapeError ? e.code : 'scrape_failed'
      return c.json({ error: code }, code === 'busy' ? 429 : code === 'timeout' ? 504 : 502)
    }
  })

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  return app
}
