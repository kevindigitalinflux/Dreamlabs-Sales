import { expect, it } from 'vitest'
import { mapMsReply, msExists } from './msExists.js'

it.each([[0, 'exists'], [5, 'exists'], [6, 'exists'], [1, 'not_found'], [2, 'unknown'], [4, 'unknown']])('maps IfExistsResult %i', (code, want) => {
  expect(mapMsReply({ IfExistsResult: code, ThrottleStatus: 0 })).toBe(want)
})
it('is unknown when throttled, malformed or missing', () => {
  expect(mapMsReply({ IfExistsResult: 0, ThrottleStatus: 1 })).toBe('unknown')
  expect(mapMsReply(null)).toBe('unknown')
  expect(mapMsReply({ IfExistsResult: '0' })).toBe('unknown')
})
it('posts only the address to the Microsoft sign-in endpoint and never follows redirects', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  const fetchImpl = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ IfExistsResult: 1, ThrottleStatus: 0 })) }) as typeof fetch
  expect(await msExists('A@B.com', { fetchImpl })).toEqual({ email: 'a@b.com', result: 'not_found' })
  expect(seen!.url).toBe('https://login.microsoftonline.com/common/GetCredentialType')
  expect(JSON.parse(String(seen!.init.body))).toEqual({ username: 'a@b.com', isOtherIdpSupported: true })
  expect(seen!.init.redirect).toBe('error')
})
it('is unknown on a network error, a non-200 reply or a timeout', async () => {
  const boom = (async () => { throw new Error('x') }) as typeof fetch
  expect((await msExists('a@b.com', { fetchImpl: boom })).result).toBe('unknown')
  const bad = (async () => new Response('no', { status: 503 })) as typeof fetch
  expect((await msExists('a@b.com', { fetchImpl: bad })).result).toBe('unknown')
  const slow = (async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
  expect((await msExists('a@b.com', { fetchImpl: slow, timeoutMs: 5 })).result).toBe('unknown')
})
