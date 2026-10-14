import { normaliseEmail } from './verifyEmail.js'
import { parseTarget, SsrfError } from './ssrf.js'

export type ScrapeMode = 'homepage' | 'key_pages' | 'deep'
const MODES = new Set<ScrapeMode>(['homepage', 'key_pages', 'deep'])

const MAX_ITEMS = 50
const MAX_STR = 300
const MAX_SOURCES = 10

const clip = (v: unknown, n = MAX_STR) => (typeof v === 'string' ? v.slice(0, n) : null)

/** Accepts "example.com", "www.example.com/team" or a full URL; returns a guarded https/http URL string. */
export function toScrapeTarget(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2000) throw new SsrfError('bad_url')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`
  return parseTarget(withScheme).toString()
}

export function toMode(raw: unknown): ScrapeMode | null {
  if (raw === undefined) return 'key_pages'
  return typeof raw === 'string' && MODES.has(raw as ScrapeMode) ? (raw as ScrapeMode) : null
}

function cleanItem(item: unknown): Record<string, unknown> | string | null {
  if (typeof item === 'string') return item.slice(0, MAX_STR)
  if (!item || typeof item !== 'object') return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v.slice(0, MAX_STR)
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string').slice(0, MAX_SOURCES).map((s) => s.slice(0, 500))
  }
  return out
}

/**
 * The scraper reads untrusted websites, so its output is untrusted too. Keep the shape, cap sizes,
 * and re-validate every email address; never pass raw error text through.
 */
export function sanitiseScrape(raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Record<string, unknown> = {
    domain: clip(r.domain, 253),
    title: clip(r.title),
    description: clip(r.description, 500),
  }
  for (const [key, value] of Object.entries(r)) {
    if (key === 'domain' || key === 'title' || key === 'description' || key === 'error') continue
    if (!Array.isArray(value)) continue
    let items = value.slice(0, MAX_ITEMS).map(cleanItem).filter((x): x is NonNullable<typeof x> => x !== null)
    if (key === 'emails') {
      items = items.filter((i) => typeof i === 'object' && normaliseEmail((i as { value?: unknown }).value) !== null)
        .map((i) => ({ ...(i as object), value: normaliseEmail((i as { value?: unknown }).value)!.email }))
    }
    out[key] = items
  }
  out.error = typeof r.error === 'string' && r.error ? 'scrape_incomplete' : null
  return out
}

export interface ScrapeDeps {
  scraperUrl: string
  scraperSecret: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class ScrapeError extends Error {
  constructor(public code: 'busy' | 'timeout' | 'scrape_failed') {
    super(code)
  }
}

export async function scrapeSite(url: string, mode: ScrapeMode, deps: ScrapeDeps): Promise<Record<string, unknown>> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 170_000)
  try {
    const res = await fetchImpl(`${deps.scraperUrl}/scrape`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-scraper-secret': deps.scraperSecret },
      body: JSON.stringify({ url, mode }),
    })
    if (res.status === 429) throw new ScrapeError('busy')
    if (!res.ok) throw new ScrapeError('scrape_failed')
    return sanitiseScrape(await res.json())
  } catch (e) {
    if (e instanceof ScrapeError) throw e
    if (controller.signal.aborted) throw new ScrapeError('timeout')
    throw new ScrapeError('scrape_failed')
  } finally {
    clearTimeout(timer)
  }
}
