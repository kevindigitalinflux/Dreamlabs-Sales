import { describe, expect, it } from 'vitest'
import { mapReacher, normaliseEmail, verifyEmail, makeDomainThrottle } from './verifyEmail.js'

describe('normaliseEmail', () => {
  it('lowercases and splits', () => {
    expect(normaliseEmail('  Max.Whatley@LoveLiving.UK ')).toEqual({ email: 'max.whatley@loveliving.uk', domain: 'loveliving.uk' })
  })
  it.each(['', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'a@127.0.0.1', 'a@[::1]', '<script>@x.com', `${'a'.repeat(65)}@x.com`, 42, null, undefined])(
    'rejects %s',
    (v) => expect(normaliseEmail(v)).toBeNull(),
  )
})

describe('mapReacher', () => {
  const base = { syntax: { is_valid_syntax: true }, mx: { accepts_mail: true }, misc: {}, smtp: { can_connect_smtp: true } }
  it('safe + deliverable is valid', () =>
    expect(mapReacher('a@b.com', { ...base, is_reachable: 'safe', smtp: { can_connect_smtp: true, is_deliverable: true } })).toMatchObject({ status: 'valid', reason: 'deliverable' }))
  it('catch-all is unverifiable, never valid', () =>
    expect(mapReacher('a@b.com', { ...base, is_reachable: 'risky', smtp: { can_connect_smtp: true, is_catch_all: true, is_deliverable: true } })).toMatchObject({ status: 'unverifiable', reason: 'catch_all' }))
  it('invalid mailbox', () => expect(mapReacher('a@b.com', { ...base, is_reachable: 'invalid' })).toMatchObject({ status: 'invalid', reason: 'mailbox_missing' }))
  it('no mail server', () => expect(mapReacher('a@b.com', { ...base, mx: { accepts_mail: false }, is_reachable: 'invalid' })).toMatchObject({ status: 'invalid', reason: 'no_mail_server' }))
  it('bad syntax', () => expect(mapReacher('a@b.com', { syntax: { is_valid_syntax: false } })).toMatchObject({ status: 'invalid', reason: 'bad_syntax' }))
  it('disposable is risky', () => expect(mapReacher('a@b.com', { ...base, misc: { is_disposable: true }, is_reachable: 'risky' })).toMatchObject({ status: 'risky', reason: 'disposable' }))
  it('role accounts are risky even when deliverable', () =>
    expect(mapReacher('info@b.com', { ...base, misc: { is_role_account: true }, is_reachable: 'safe', smtp: { can_connect_smtp: true, is_deliverable: true } })).toMatchObject({ status: 'risky', reason: 'role_account' }))
  it('unknown and blocked connections are unverifiable', () => {
    expect(mapReacher('a@b.com', { ...base, is_reachable: 'unknown', smtp: { can_connect_smtp: false } })).toMatchObject({ status: 'unverifiable', reason: 'provider_blocks_checks' })
    expect(mapReacher('a@b.com', { is_reachable: 'unknown' })).toMatchObject({ status: 'unverifiable', reason: 'unknown' })
  })
  it('garbage in gives unverifiable, not a crash', () => {
    expect(mapReacher('a@b.com', null).status).toBe('unverifiable')
    expect(mapReacher('a@b.com', 'text').status).toBe('unverifiable')
  })
})

describe('verifyEmail', () => {
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })
  it('calls Reacher and maps the reply', async () => {
    let seen = ''
    const r = await verifyEmail('a@b.com', {
      reacherUrl: 'http://reacher:8080', reacherSecret: 's',
      fetchImpl: (async (u: string, init: RequestInit) => {
        seen = `${u} ${(init.headers as Record<string, string>)['x-reacher-secret']} ${init.body}`
        return new Response(JSON.stringify({ is_reachable: 'invalid', syntax: { is_valid_syntax: true }, mx: { accepts_mail: true } }))
      }) as never,
    })
    expect(seen).toBe('http://reacher:8080/v0/check_email s {"to_email":"a@b.com"}')
    expect(r).toMatchObject({ status: 'invalid' })
  })
  it('maps a Reacher error status to checker_error, with no provider text', async () => {
    const r = await verifyEmail('a@b.com', { reacherUrl: 'http://x', fetchImpl: (async () => new Response('boom secret details', { status: 500 })) as never })
    expect(r).toEqual({ email: 'a@b.com', status: 'unverifiable', reason: 'checker_error' })
  })
  it('maps a network failure and a timeout to checker_error', async () => {
    expect((await verifyEmail('a@b.com', { reacherUrl: 'http://x', fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as never })).reason).toBe('checker_error')
    const slow = (async (_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as never
    expect((await verifyEmail('a@b.com', { reacherUrl: 'http://x', fetchImpl: slow, timeoutMs: 20 })).reason).toBe('checker_error')
  })
  void ok
})

describe('makeDomainThrottle', () => {
  it('allows 5 checks a minute per domain and keeps domains separate', () => {
    const t = makeDomainThrottle(5, () => 0)
    const first = Array.from({ length: 6 }, () => t.take('a.com'))
    expect(first).toEqual([true, true, true, true, true, false])
    expect(t.take('b.com')).toBe(true)
  })
})
