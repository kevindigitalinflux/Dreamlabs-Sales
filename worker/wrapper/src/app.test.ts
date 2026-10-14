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
