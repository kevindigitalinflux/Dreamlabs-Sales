import { createHash } from 'node:crypto'
import { DomainStallBreaker } from './domainStall.js'
import { Hono } from 'hono'
import { secretMatches } from './auth.js'
import { RateLimiter } from './rateLimit.js'
import { safeFetchText, SsrfError, type SafeFetchOptions } from './ssrf.js'
import { makeDomainThrottle, normaliseEmail, type VerifyResult } from './verifyEmail.js'
import { ScrapeError, toMode, toScrapeTarget, type ScrapeMode } from './scrapeSite.js'
import { msExists } from './msExists.js'
import type { searchWeb } from './search.js'

export interface AppDeps {
  search?: (query: string) => ReturnType<typeof searchWeb>
  searchPerMinute?: number
  msPerMinute?: number
  msExistsImpl?: typeof msExists
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
    await next()
  })

  // One privacy-safe line for every verify route request, including refusals.
  // Only authenticated requests reach body parsing and domain hashing.
  app.use('/verify-email', async (c, next) => {
    const started = Date.now()
    const body = await c.req.raw.clone().json().catch(() => null)
    const domain = normaliseEmail(body?.email)?.domain ?? ''
    try { await next() } finally {
      const answer = await c.res.clone().json().catch(() => null)
      const allowed = new Set(['deliverable','bad_syntax','no_mail_server','mailbox_missing','mailbox_disabled','catch_all','disposable','full_inbox','role_account','provider_blocks_checks','unknown','checker_error','timeout','unauthorized','rate_limited','not_configured','bad_request','domain_throttled','domain_stalled'])
      const code = answer?.reason ?? answer?.error
      console.info(JSON.stringify({ reason: allowed.has(code) ? code : 'checker_error', duration_ms: Date.now() - started, domain_hash: createHash('sha256').update(domain).digest('hex').slice(0, 8) }))
    }
  })

  // Keep authenticated budget refusals inside the verify logging middleware.
  app.use('*', async (c, next) => {
    if (!limiter.take('global')) return c.json({ error: 'rate_limited' }, 429)
    await next()
  })

  app.get('/health', (c) => c.json({ ok: true }))

  const searchLimiter = new RateLimiter(deps.searchPerMinute ?? 20, 60_000)
  app.post('/search', async c => {
    const body = await c.req.json().catch(() => null)
    const query = body?.query
    if (typeof query !== 'string' || query.trim().length < 3 || query.length > 300) return c.json({ error: 'bad_request' }, 400)
    if (!deps.search) return c.json({ error: 'not_configured' }, 503)
    if (!searchLimiter.take('search')) return c.json({ error: 'rate_limited' }, 429)
    try {
      const result = await deps.search(query.trim())
      if (result.ok) return c.json({ results: result.results })
      return c.json({ error: result.error }, result.error === 'timeout' ? 504 : result.error === 'throttled' ? 429 : 502)
    } catch { return c.json({ error: 'upstream' }, 502) }
  })

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

  const stalls = new DomainStallBreaker()
  const domainThrottle = makeDomainThrottle(deps.perDomainPerMinute ?? 5)
  const msLimiter = new RateLimiter(deps.msPerMinute ?? 20, 60_000)
  app.post('/ms-exists', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = normaliseEmail(body && typeof body === 'object' ? (body as { email?: unknown }).email : undefined)
    if (!parsed) return c.json({ error: 'bad_email' }, 400)
    if (!msLimiter.take('microsoft')) return c.json({ error: 'rate_limited' }, 429)
    return c.json(await (deps.msExistsImpl ?? msExists)(parsed.email))
  })

  // Mailbox check through Reacher. Answers only valid / invalid / risky / unverifiable plus a fixed reason code.
  app.post('/verify-email', async (c) => {
    if (!deps.verify) return c.json({ error: 'not_configured' }, 503)
    const body = await c.req.json().catch(() => null)
    const parsed = normaliseEmail(body && typeof body === 'object' ? (body as { email?: unknown }).email : undefined)
    if (!parsed) return c.json({ error: 'bad_request' }, 400)
    if (stalls.blocked(parsed.domain)) return c.json({ error: 'domain_stalled' }, 429)
    if (!domainThrottle.take(parsed.domain)) return c.json({ error: 'domain_throttled' }, 429)
    let answer: VerifyResult
    try { answer = await deps.verify(parsed.email) }
    catch { answer = { email: parsed.email, status: 'unverifiable', reason: 'checker_error' } }
    stalls.record(parsed.domain, answer)
    return c.json(answer)
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
