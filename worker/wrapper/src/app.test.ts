import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'
import { secretMatches } from './auth.js'

const SECRET = 'a'.repeat(40)

describe('secretMatches', () => {
  it('accepts the exact secret', () => expect(secretMatches(SECRET, SECRET)).toBe(true))
  it('rejects a wrong or missing secret', () => {
    expect(secretMatches(SECRET, 'b'.repeat(40))).toBe(false)
    expect(secretMatches(SECRET, undefined)).toBe(false)
    expect(secretMatches(SECRET, '')).toBe(false)
  })
  it('never matches when the expected secret is unset', () => {
    expect(secretMatches(undefined, '')).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })
})

describe('app', () => {
  const app = buildApp(SECRET)
  it('401 without the header, even on unknown paths', async () => {
    expect((await app.request('/health')).status).toBe(401)
    expect((await app.request('/nope')).status).toBe(401)
  })
  it('401 with a wrong header', async () => {
    expect((await app.request('/health', { headers: { 'x-worker-secret': 'x' } })).status).toBe(401)
  })
  it('200 on /health with the right header', async () => {
    const r = await app.request('/health', { headers: { 'x-worker-secret': SECRET } })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })
  it('404 for unknown paths when authorised', async () => {
    expect((await app.request('/nope', { headers: { 'x-worker-secret': SECRET } })).status).toBe(404)
  })
})

describe('POST /fetch-page', () => {
  const auth = { 'x-worker-secret': SECRET, 'content-type': 'application/json' }
  const post = (a: ReturnType<typeof buildApp>, body: unknown) =>
    a.request('/fetch-page', { method: 'POST', headers: auth, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('returns page text through the guard', async () => {
    const a = buildApp(SECRET, {
      fetchOptions: { fetchImpl: async () => new Response('<h1>Team</h1>', { headers: { 'content-type': 'text/html' } }) },
    })
    const r = await post(a, { url: 'https://example.com/team' })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ final_url: 'https://example.com/team', status: 200, body: '<h1>Team</h1>', truncated: false })
  })
  it('refuses private targets with a plain code and no provider text', async () => {
    const r = await post(buildApp(SECRET), { url: 'http://169.254.169.254/latest/meta-data' })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'bad_host' })
  })
  it('400 on a missing url, bad json, or an oversized url', async () => {
    const a = buildApp(SECRET)
    expect((await post(a, {})).status).toBe(400)
    expect((await post(a, 'not json')).status).toBe(400)
    expect((await post(a, { url: 'https://e.com/' + 'a'.repeat(2100) })).status).toBe(400)
  })
  it('requires the secret', async () => {
    const r = await buildApp(SECRET).request('/fetch-page', { method: 'POST', body: '{}' })
    expect(r.status).toBe(401)
  })
  it('429 once the shared budget is spent', async () => {
    const a = buildApp(SECRET, { perMinute: 2 })
    const h = { 'x-worker-secret': SECRET }
    const statuses = [] as number[]
    for (let i = 0; i < 3; i++) statuses.push((await a.request('/health', { headers: h })).status)
    expect(statuses).toEqual([200, 200, 429])
  })
})
