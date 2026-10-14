import { describe, expect, it } from 'vitest'
import { isPublicIp, parseTarget, SsrfError, safeFetchText, guardedLookup } from './ssrf.js'

describe('isPublicIp', () => {
  it.each([
    '8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e',
  ])('allows public %s', (ip) => expect(isPublicIp(ip)).toBe(true))

  it.each([
    '0.0.0.0', '10.0.0.1', '100.64.0.1', '127.0.0.1', '127.1.2.3', '169.254.169.254', '172.16.0.1', '172.31.255.255',
    '192.0.0.1', '192.0.2.5', '192.168.1.1', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::1', 'not-an-ip', '',
  ])('blocks %s', (ip) => expect(isPublicIp(ip)).toBe(false))

  it('treats the 172.16/12 boundaries correctly', () => {
    expect(isPublicIp('172.15.0.1')).toBe(true)
    expect(isPublicIp('172.32.0.1')).toBe(true)
  })
})

describe('parseTarget', () => {
  const code = (raw: string) => {
    try { parseTarget(raw); return 'ok' } catch (e) { return (e as SsrfError).code }
  }
  it('accepts plain http and https', () => {
    expect(code('https://example.com/team')).toBe('ok')
    expect(code('http://example.co.uk')).toBe('ok')
  })
  it.each([
    ['ftp://example.com', 'bad_scheme'], ['file:///etc/passwd', 'bad_scheme'], ['javascript:alert(1)', 'bad_scheme'],
    ['https://user:pw@example.com', 'bad_credentials'],
    ['https://example.com:8080', 'bad_port'], ['http://example.com:22', 'bad_port'],
    ['http://127.0.0.1', 'bad_host'], ['http://[::1]/', 'bad_host'], ['http://169.254.169.254/latest/meta-data', 'bad_host'],
    ['http://2130706433/', 'bad_host'], ['http://0x7f000001/', 'bad_host'], ['http://0177.0.0.1/', 'bad_host'],
    ['http://localhost', 'bad_host'], ['http://foo.localhost', 'bad_host'], ['http://intranet', 'bad_host'],
    ['http://metadata.google.internal', 'bad_host'], ['http://printer.local', 'bad_host'],
    ['not a url', 'bad_url'], ['', 'bad_url'],
  ])('rejects %s', (raw, expected) => expect(code(raw)).toBe(expected))
})

describe('guardedLookup', () => {
  const run = (host: string, resolved: string[]) =>
    new Promise<{ err?: SsrfError; addrs?: unknown }>((resolve) => {
      guardedLookup(
        host,
        { all: true },
        (err, addrs) => resolve({ err: (err ?? undefined) as SsrfError | undefined, addrs }),
        async () => resolved.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      )
    })
  it('passes public answers through', async () => {
    const r = await run('example.com', ['93.184.216.34'])
    expect(r.err).toBeUndefined()
  })
  it('refuses when ANY answer is private (rebinding mix)', async () => {
    const r = await run('evil.example', ['93.184.216.34', '127.0.0.1'])
    expect(r.err?.code).toBe('bad_resolved_address')
  })
  it('refuses when nothing resolves', async () => {
    expect((await run('nx.example', [])).err?.code).toBe('dns_failed')
  })
})

describe('safeFetchText', () => {
  const resp = (body: string, init: ResponseInit = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init })

  it('returns the body and final url', async () => {
    const r = await safeFetchText('https://example.com/', { fetchImpl: async () => resp('<p>hi</p>') })
    expect(r.status).toBe(200)
    expect(r.body).toBe('<p>hi</p>')
    expect(r.finalUrl).toBe('https://example.com/')
  })
  it('follows a redirect and re-validates the target', async () => {
    const calls: string[] = []
    const r = await safeFetchText('https://example.com/a', {
      fetchImpl: async (u) => {
        calls.push(String(u))
        return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/b' } }) : resp('ok')
      },
    })
    expect(calls).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(r.finalUrl).toBe('https://example.com/b')
  })
  it('blocks a redirect to a private address', async () => {
    await expect(safeFetchText('https://example.com/', {
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest' } }),
    })).rejects.toMatchObject({ code: 'bad_host' })
  })
  it('stops after too many redirects', async () => {
    await expect(safeFetchText('https://example.com/', {
      maxRedirects: 2,
      fetchImpl: async () => new Response(null, { status: 301, headers: { location: '/loop' } }),
    })).rejects.toMatchObject({ code: 'too_many_redirects' })
  })
  it('truncates bodies at maxBytes and says so', async () => {
    const r = await safeFetchText('https://example.com/', { maxBytes: 10, fetchImpl: async () => resp('x'.repeat(100)) })
    expect(r.body.length).toBe(10)
    expect(r.truncated).toBe(true)
  })
  it('refuses non-text content', async () => {
    await expect(safeFetchText('https://example.com/f.zip', {
      fetchImpl: async () => new Response('PK', { headers: { 'content-type': 'application/zip' } }),
    })).rejects.toMatchObject({ code: 'bad_content_type' })
  })
  it('times out', async () => {
    await expect(safeFetchText('https://example.com/', {
      timeoutMs: 20,
      fetchImpl: (_u, init) =>
        new Promise((_res, rej) => {
          init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        }),
    })).rejects.toMatchObject({ code: 'timeout' })
  })
})
