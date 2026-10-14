import { describe, expect, it } from 'vitest'
import { sanitiseScrape, scrapeSite, ScrapeError, toMode, toScrapeTarget } from './scrapeSite.js'

describe('toScrapeTarget', () => {
  it('adds https and runs the SSRF guard', () => {
    expect(toScrapeTarget('loveliving.uk')).toBe('https://loveliving.uk/')
    expect(toScrapeTarget(' http://www.example.com/team ')).toBe('http://www.example.com/team')
  })
  it.each(['http://127.0.0.1', 'localhost', '169.254.169.254', 'file:///etc/passwd', 'intranet', '', 42, undefined])('rejects %s', (v) => {
    expect(() => toScrapeTarget(v)).toThrow()
  })
})

describe('toMode', () => {
  it('defaults and validates', () => {
    expect(toMode(undefined)).toBe('key_pages')
    expect(toMode('deep')).toBe('deep')
    expect(toMode('crawl_everything')).toBeNull()
    expect(toMode(7)).toBeNull()
  })
})

describe('sanitiseScrape', () => {
  it('keeps the shape, drops invalid emails, lowercases, and never passes raw error text', () => {
    const out = sanitiseScrape({
      domain: 'Example.com', title: 'T', description: 'D', error: 'ValueError: secret path /app/x.py',
      emails: [
        { value: 'Hello@Example.com', sources: ['https://example.com/contact'], is_likely_official: true },
        { value: 'not-an-email', sources: [] },
        { value: '<script>@x.com' },
      ],
      phones: [{ value: '+441234567890', sources: ['https://example.com'] }],
      surprise: 'ignored (not a list)',
    })
    expect(out.emails).toEqual([{ value: 'hello@example.com', sources: ['https://example.com/contact'], is_likely_official: true }])
    expect(out.phones).toEqual([{ value: '+441234567890', sources: ['https://example.com'] }])
    expect(out).not.toHaveProperty('surprise')
    expect(out.error).toBe('scrape_incomplete')
  })
  it('caps list sizes and string lengths, and tolerates junk', () => {
    const big = sanitiseScrape({ domain: 'a.com', phones: Array.from({ length: 500 }, (_, i) => ({ value: 'x'.repeat(1000) + i })) })
    expect((big.phones as unknown[]).length).toBe(50)
    expect(((big.phones as { value: string }[])[0]!).value.length).toBe(300)
    expect(sanitiseScrape(null)).toMatchObject({ domain: null, error: null })
    expect(sanitiseScrape('string')).toMatchObject({ domain: null })
  })
})

describe('scrapeSite', () => {
  const deps = (impl: unknown) => ({ scraperUrl: 'http://scraper:8000', scraperSecret: 's'.repeat(40), fetchImpl: impl as typeof fetch, timeoutMs: 50 })
  it('posts url and mode with the secret header and sanitises the answer', async () => {
    let seen = ''
    const r = await scrapeSite('https://example.com/', 'homepage', deps(async (u: string, init: RequestInit) => {
      seen = `${u} ${(init.headers as Record<string, string>)['x-scraper-secret']!.length} ${init.body}`
      return new Response(JSON.stringify({ domain: 'example.com', emails: [{ value: 'a@example.com' }], error: null }))
    }))
    expect(seen).toBe('http://scraper:8000/scrape 40 {"url":"https://example.com/","mode":"homepage"}')
    expect(r.emails).toEqual([{ value: 'a@example.com' }])
  })
  it('maps busy, failure and timeout to fixed codes', async () => {
    await expect(scrapeSite('https://e.com/', 'homepage', deps(async () => new Response('x', { status: 429 })))).rejects.toMatchObject({ code: 'busy' })
    await expect(scrapeSite('https://e.com/', 'homepage', deps(async () => new Response('x', { status: 500 })))).rejects.toMatchObject({ code: 'scrape_failed' })
    await expect(scrapeSite('https://e.com/', 'homepage', deps(async () => { throw new Error('ECONNREFUSED') }))).rejects.toBeInstanceOf(ScrapeError)
    const slow = async (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
    await expect(scrapeSite('https://e.com/', 'homepage', deps(slow))).rejects.toMatchObject({ code: 'timeout' })
  })
})
