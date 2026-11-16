import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.js'
import { secretMatches } from './auth.js'

const SECRET = 'a'.repeat(40)
it.each([undefined,'wrong-secret'])('refuses secret %s before reading or hashing the verify body',async secret=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{})
 try {
  const headers:Record<string,string>={'content-type':'application/json'}
  if(secret) headers['x-worker-secret']=secret
  const request=new Request('http://localhost/verify-email',{method:'POST',headers,body:JSON.stringify({email:'private@private.test'})})
  const clone=vi.spyOn(request,'clone'),read=vi.spyOn(request,'json')
  const response=await buildApp(SECRET).fetch(request)
  expect(response.status).toBe(401);expect(await response.json()).toEqual({error:'unauthorized'})
  expect(clone).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(request.bodyUsed).toBe(false)
  expect(log).not.toHaveBeenCalled()
 } finally {vi.restoreAllMocks()}
})
it('logs one line per authenticated verify request including global-budget refusals',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{})
 try {
  const verify=vi.fn(async(email:string)=>({email,status:'valid' as const,reason:'deliverable'}))
  const app=buildApp(SECRET,{verify,perMinute:1})
  const post=()=>app.request('/verify-email',{method:'POST',headers:{'x-worker-secret':SECRET,'content-type':'application/json'},body:JSON.stringify({email:'private@private.test'})})
  expect((await post()).status).toBe(200);expect((await post()).status).toBe(429)
  expect(verify).toHaveBeenCalledTimes(1);expect(log).toHaveBeenCalledTimes(2)
  expect(log.mock.calls.map(([line])=>JSON.parse(line).reason)).toEqual(['deliverable','rate_limited'])
  for(const [line] of log.mock.calls){expect(JSON.parse(line).domain_hash).toMatch(/^[a-f0-9]{8}$/);expect(line).not.toContain('private');expect(line).not.toContain('@')}
 } finally {log.mockRestore()}
})
describe('POST /ms-exists', () => {
  const fake = async (email: string) => ({ email, result: 'exists' as const })
  const post = (app: ReturnType<typeof buildApp>, email: string) => app.request('/ms-exists', { method: 'POST', headers: { 'x-worker-secret': SECRET, 'content-type': 'application/json' }, body: JSON.stringify({ email }) })
  it('needs the secret header and validates the exact address', async () => {
    const app = buildApp(SECRET, { msExistsImpl: fake })
    expect((await app.request('/ms-exists', { method: 'POST' })).status).toBe(401)
    const bad = await post(app, 'junk')
    expect(bad.status).toBe(400); expect(await bad.json()).toEqual({ error: 'bad_email' })
    expect(await (await post(app, 'A@B.com')).json()).toEqual({ email: 'a@b.com', result: 'exists' })
  })
  it('limits Microsoft checks to twenty per minute across callers', async () => {
    const app = buildApp(SECRET, { msExistsImpl: fake })
    for (let i = 0; i < 20; i++) expect((await post(app, `p${i}@a.com`)).status).toBe(200)
    expect((await post(app, 'last@b.com')).status).toBe(429)
  })
})

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

describe('POST /scrape-site', () => {
  const auth = { 'x-worker-secret': SECRET, 'content-type': 'application/json' }
  const post = (a: ReturnType<typeof buildApp>, body: unknown) =>
    a.request('/scrape-site', { method: 'POST', headers: auth, body: JSON.stringify(body) })
  const fake = async (url: string, mode: string) => ({ domain: new URL(url).hostname, mode, emails: [] })

  it('guards the target, defaults the mode and returns the scrape', async () => {
    const r = await post(buildApp(SECRET, { scrape: fake as never }), { url: 'loveliving.uk' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ domain: 'loveliving.uk', mode: 'key_pages', emails: [] })
  })
  it('422 for private targets, 400 for a bad mode, 503 when not configured', async () => {
    const a = buildApp(SECRET, { scrape: fake as never })
    const priv = await post(a, { url: 'http://169.254.169.254/' })
    expect(priv.status).toBe(422)
    expect(await priv.json()).toEqual({ error: 'bad_host' })
    expect((await post(a, { url: 'example.com', mode: 'everything' })).status).toBe(400)
    expect((await post(buildApp(SECRET), { url: 'example.com' })).status).toBe(503)
  })
  it('maps scraper failures to fixed codes without leaking text', async () => {
    const mk = (code: string) => buildApp(SECRET, { scrape: (async () => { throw Object.assign(new Error('internal /app/secret'), { code }) }) as never })
    const r = await post(mk('x'), { url: 'example.com' })
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'scrape_failed' })
  })
  it('has its own tight rate limit', async () => {
    const a = buildApp(SECRET, { scrape: fake as never, scrapePerMinute: 1 })
    expect([(await post(a, { url: 'a.com' })).status, (await post(a, { url: 'b.com' })).status]).toEqual([200, 429])
  })
})

describe('POST /verify-email', () => {
  const auth = { 'x-worker-secret': SECRET, 'content-type': 'application/json' }
  const post = (a: ReturnType<typeof buildApp>, body: unknown) =>
    a.request('/verify-email', { method: 'POST', headers: auth, body: JSON.stringify(body) })
  const fake = async (email: string) => ({ email, status: 'valid' as const, reason: 'deliverable' as const })

  it('verifies a normalised address', async () => {
    const r = await post(buildApp(SECRET, { verify: fake }), { email: ' Max@LoveLiving.uk ' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ email: 'max@loveliving.uk', status: 'valid', reason: 'deliverable' })
  })
  it('400 for junk, 503 when no checker is configured', async () => {
    expect((await post(buildApp(SECRET, { verify: fake }), { email: 'nope' })).status).toBe(400)
    expect((await post(buildApp(SECRET), { email: 'a@b.com' })).status).toBe(503)
  })
  it('throttles repeated checks on one domain', async () => {
    const a = buildApp(SECRET, { verify: fake, perDomainPerMinute: 2 })
    const codes: number[] = []
    for (let i = 0; i < 3; i++) codes.push((await post(a, { email: `p${i}@one.com` })).status)
    codes.push((await post(a, { email: 'x@two.com' })).status)
    expect(codes).toEqual([200, 200, 429, 200])
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

it('refuses stalled domains without Reacher, preserves other domains, and logs only fixed fields',async()=>{
 vi.useFakeTimers();const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 try {
 let calls=0;const app=buildApp(SECRET,{verify:async email=>{calls++;return {email,status:'unverifiable',reason:'timeout'}},perDomainPerMinute:100});
 const post=(email:string)=>app.request('/verify-email',{method:'POST',headers:{'x-worker-secret':SECRET,'content-type':'application/json'},body:JSON.stringify({email})});
 expect((await post('a@private.test')).status).toBe(200);expect((await post('b@private.test')).status).toBe(200);
 const blocked=await post('c@private.test');expect(blocked.status).toBe(429);expect(await blocked.json()).toEqual({error:'domain_stalled'});expect(calls).toBe(2);
 expect((await post('a@other.test')).status).toBe(200);expect(calls).toBe(3);
 await vi.advanceTimersByTimeAsync(600000);expect((await post('d@private.test')).status).toBe(200);expect(calls).toBe(4);
 expect(log).toHaveBeenCalledTimes(5);
 for(const [line] of log.mock.calls){const entry=JSON.parse(line);expect(Object.keys(entry).sort()).toEqual(['domain_hash','duration_ms','reason']);expect(entry.domain_hash).toMatch(/^[a-f0-9]{8}$/);expect(entry.duration_ms).toBeGreaterThanOrEqual(0);expect(line).not.toContain('private.test');expect(line).not.toContain('@');}
 } finally {vi.useRealTimers();log.mockRestore()}
});

describe('POST /search',()=>{
 const post=(app:ReturnType<typeof buildApp>,body:unknown)=>app.request('/search',{method:'POST',headers:{'x-worker-secret':SECRET,'content-type':'application/json'},body:JSON.stringify(body)});
 it('validates query and guards config and secret',async()=>{
  const app=buildApp(SECRET,{search:async()=>({ok:true,results:[]})});
  expect((await app.request('/search',{method:'POST'})).status).toBe(401);
  for(const query of [null,42,'ab','x'.repeat(301)])expect((await post(app,{query})).status).toBe(400);
  expect((await post(buildApp(SECRET),{query:'valid query'})).status).toBe(503);
  expect(await (await post(app,{query:'valid query'})).json()).toEqual({results:[]});
 });
 it.each([['timeout',504],['upstream',502],['bad_response',502],['throttled',429]] as const)('maps %s to %i',async(error,status)=>{const result=await post(buildApp(SECRET,{search:async()=>({ok:false,error})}),{query:'query'});expect(result.status).toBe(status);expect(await result.json()).toEqual({error})});
 it('limits searches to twenty per minute shared across queries',async()=>{
  const app=buildApp(SECRET,{search:async()=>({ok:true,results:[]})});for(let i=0;i<20;i++)expect((await post(app,{query:'query '+i})).status).toBe(200);expect((await post(app,{query:'last query'})).status).toBe(429);
 });
});
