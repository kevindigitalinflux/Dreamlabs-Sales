import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageClient } from '../../supabase/functions/_shared/usage';
import { refusalLine } from '../../supabase/functions/_shared/usageRules';
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient';
import { MAX_VERIFY_PER_LEAD, workerFailureLine, type WorkerConfig } from '../../supabase/functions/_shared/workerRules';

const CONFIG: WorkerConfig = { url: 'https://lookup.didreamlabs.com', secret: 'sekret-abc-123' };
const ALLOWED = { ok: true, day: '2026-10-14', used: 1, limit: 100, global_used: 1, global_limit: 400 };
const REFUSED = { ok: false, reason: 'org_limit', limit: 150 };
const VERIFY_OK = { email: 'max@loveliving.uk', status: 'valid', reason: 'deliverable' };
const SCRAPE_OK = { emails: [{ value: 'max@loveliving.uk', sources: ['https://loveliving.uk/team'] }], phones: [] };

type Call = [string, Record<string, unknown>];
type Reply = { data: unknown; error: { message: string } | null };
type FakeUsage = UsageClient & { calls: Call[] };

/** Fake usage client: records [fn, args]; `reserve` may be a reply, or a function of the reserve call number. */
function usage(reserve: Reply | ((n: number) => Reply) = { data: ALLOWED, error: null }): FakeUsage {
  const calls: Call[] = [];
  let reserves = 0;
  return {
    calls,
    rpc: (fn, args) => {
      calls.push([fn, args]);
      if (fn === 'usage_reserve') {
        reserves++;
        return Promise.resolve(typeof reserve === 'function' ? reserve(reserves) : reserve);
      }
      return Promise.resolve({ data: true, error: null });
    },
  };
}

const fnCalls = (u: FakeUsage, fn: string) => u.calls.filter(([f]) => f === fn);
const reserveCalls = (u: FakeUsage) => fnCalls(u, 'usage_reserve');
const refundCalls = (u: FakeUsage) => fnCalls(u, 'usage_refund');

/** Fake fetch answering every call with the same status and body. */
function worker(status: number, body: unknown) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

const make = (u: UsageClient, fetchImpl: typeof fetch, config: WorkerConfig | null = CONFIG) =>
  makeWorkerClient({ usage: u, orgId: 'org-1', config, fetchImpl });

afterEach(() => { vi.useRealTimers(); });

describe('makeWorkerClient', () => {
  it('returns not_configured without reserving or calling when there is no config', async () => {
    const u = usage();
    const f = worker(200, VERIFY_OK);
    const c = make(u, f, null);
    const r = await c.verifyEmail('max@loveliving.uk');
    expect(r).toEqual({ ok: false, failure: 'not_configured', line: 'The lookup worker is not set up, so it was not used.' });
    expect(u.calls.length).toBe(0);
    expect(f).not.toHaveBeenCalled();
    expect(c.lines()).toEqual(['The lookup worker is not set up, so it was not used.']);
  });

  it('reserves before it calls, sends the secret header, and does not refund a completed verify', async () => {
    const order: string[] = [];
    const u = usage();
    const origRpc = u.rpc.bind(u);
    u.rpc = (fn, args) => { order.push(fn); return origRpc(fn, args); };
    const f = vi.fn<typeof fetch>(() => { order.push('fetch'); return Promise.resolve(new Response(JSON.stringify(VERIFY_OK), { status: 200 })); });
    const r = await make(u, f).verifyEmail('max@loveliving.uk');
    expect(r).toEqual({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
    expect(order).toEqual(['usage_reserve', 'fetch']);
    expect(u.calls[0]).toEqual(['usage_reserve', { p_org: 'org-1', p_resource: 'worker_verify', p_units: 1 }]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://lookup.didreamlabs.com/verify-email');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json', 'x-worker-secret': CONFIG.secret });
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'max@loveliving.uk' });
    expect(refundCalls(u).length).toBe(0);
  });

  it('maps a valid reply to ok and counts it in the tally line', async () => {
    const c = make(usage(), worker(200, VERIFY_OK));
    const r = await c.verifyEmail('max@loveliving.uk');
    expect(r.ok).toBe(true);
    expect(c.lines()).toEqual(['Checked 1 email address with our own checker (1 valid, 0 not real, 0 could not be confirmed).']);
  });

  it('treats a reply for another address as bad_response, keeps the units, and does not stop later checks', async () => {
    const u = usage();
    const f = worker(200, { email: 'someone@else.com', status: 'valid', reason: 'deliverable' });
    const c = make(u, f);
    const r = await c.verifyEmail('max@loveliving.uk');
    expect(r).toEqual({ ok: false, failure: 'bad_response', line: workerFailureLine('bad_response') });
    expect(refundCalls(u).length).toBe(0);
    await c.verifyEmail('max@loveliving.uk');
    expect(reserveCalls(u).length).toBe(2);
    expect(f).toHaveBeenCalledTimes(2);
    expect(refundCalls(u).length).toBe(0);
  });

  it('refunds exactly once, with the reserve day, when the worker is unreachable, and then stops that kind', async () => {
    const u = usage();
    const f = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('connect failed')));
    const c = make(u, f);
    const r = await c.verifyEmail('max@loveliving.uk');
    expect(r).toEqual({ ok: false, failure: 'unreachable', line: workerFailureLine('unreachable') });
    expect(refundCalls(u)).toEqual([['usage_refund', { p_org: 'org-1', p_resource: 'worker_verify', p_units: 1, p_day: '2026-10-14' }]]);
    const again = await c.verifyEmail('max@loveliving.uk');
    expect(again).toEqual({ ok: false, failure: 'unreachable', line: workerFailureLine('unreachable') });
    expect(reserveCalls(u).length).toBe(1);
    expect(refundCalls(u).length).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('refunds once on 429 (busy) and once on 503, never on 422', async () => {
    const busyU = usage();
    const busy = await make(busyU, worker(429, { error: 'busy' })).verifyEmail('max@loveliving.uk');
    expect(busy).toMatchObject({ ok: false, failure: 'busy' });
    expect(refundCalls(busyU).length).toBe(1);

    const downU = usage();
    const down = await make(downU, worker(503, {})).verifyEmail('max@loveliving.uk');
    expect(down).toMatchObject({ ok: false, failure: 'unreachable' });
    expect(refundCalls(downU).length).toBe(1);

    const badU = usage();
    const bad = await make(badU, worker(422, { error: 'nope' })).verifyEmail('max@loveliving.uk');
    expect(bad).toMatchObject({ ok: false, failure: 'bad_response' });
    expect(refundCalls(badU).length).toBe(0);
  });

  it('does not call the worker when the reserve is refused, and uses the usage wording', async () => {
    const u = usage({ data: REFUSED, error: null });
    const f = worker(200, VERIFY_OK);
    const c = make(u, f);
    const r = await c.verifyEmail('max@loveliving.uk');
    const line = refusalLine('org_limit', 'worker_verify', 150);
    expect(r).toEqual({ ok: false, failure: 'limit_reached', line });
    expect(f).not.toHaveBeenCalled();
    expect(refundCalls(u).length).toBe(0);
    expect(c.lines()).toEqual([line]);
    // stopped: no second reserve
    await c.verifyEmail('max@loveliving.uk');
    expect(reserveCalls(u).length).toBe(1);
  });

  it('fails closed when the reserve call errors', async () => {
    const u = usage({ data: null, error: { message: 'db down' } });
    const f = worker(200, VERIFY_OK);
    const r = await make(u, f).verifyEmail('max@loveliving.uk');
    expect(r).toEqual({ ok: false, failure: 'limit_reached', line: refusalLine('error', 'worker_verify') });
    expect(f).not.toHaveBeenCalled();
    expect(refundCalls(u).length).toBe(0);
  });

  it('keeps verify and scrape independent: a refused scrape does not stop verify', async () => {
    const u = usage((n) => (n === 1 ? { data: REFUSED, error: null } : { data: ALLOWED, error: null }));
    const f = vi.fn<typeof fetch>((input) => {
      const body = String(input).endsWith('/verify-email') ? VERIFY_OK : SCRAPE_OK;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    const c = make(u, f);
    const s = await c.scrapeSite('loveliving.uk');
    expect(s).toMatchObject({ ok: false, failure: 'limit_reached' });
    expect(f).not.toHaveBeenCalled();
    const v = await c.verifyEmail('max@loveliving.uk');
    expect(v.ok).toBe(true);
    expect(reserveCalls(u).map(([, a]) => a.p_resource)).toEqual(['worker_scrape', 'worker_verify']);
    // and the scrape stays stopped
    await c.scrapeSite('loveliving.uk');
    expect(reserveCalls(u).length).toBe(2);
  });

  it('caps email checks at 6 per client', async () => {
    const u = usage();
    const f = worker(200, VERIFY_OK);
    const c = make(u, f);
    for (let i = 0; i < MAX_VERIFY_PER_LEAD; i++) {
      expect((await c.verifyEmail('max@loveliving.uk')).ok).toBe(true);
    }
    expect(MAX_VERIFY_PER_LEAD).toBe(6);
    const seventh = await c.verifyEmail('max@loveliving.uk');
    expect(seventh).toMatchObject({ ok: false, failure: 'limit_reached' });
    expect(reserveCalls(u).length).toBe(6);
    expect(f).toHaveBeenCalledTimes(6);
    expect(c.lines()).toContain('Only 6 email checks are used for one lead in one Deep find.');
    // verify is stopped; later calls also do not reserve
    await c.verifyEmail('max@loveliving.uk');
    expect(reserveCalls(u).length).toBe(6);
  });

  it('charges 3 units for a deep scrape and 1 for key_pages', async () => {
    const deepU = usage();
    const deepF = worker(200, SCRAPE_OK);
    await make(deepU, deepF).scrapeSite('loveliving.uk', 'deep');
    expect(reserveCalls(deepU)[0]![1]).toEqual({ p_org: 'org-1', p_resource: 'worker_scrape', p_units: 3 });
    const [url, init] = deepF.mock.calls[0]!;
    expect(url).toBe('https://lookup.didreamlabs.com/scrape-site');
    expect(JSON.parse(String(init?.body))).toEqual({ url: 'https://loveliving.uk', mode: 'deep' });

    const keyU = usage();
    const keyF = worker(200, SCRAPE_OK);
    await make(keyU, keyF).scrapeSite('loveliving.uk');
    expect(reserveCalls(keyU)[0]![1]).toMatchObject({ p_units: 1 });
    expect(JSON.parse(String(keyF.mock.calls[0]![1]?.body))).toEqual({ url: 'https://loveliving.uk', mode: 'key_pages' });

    // a refund of a deep scrape gives back all 3 units
    const failU = usage();
    await make(failU, worker(429, {})).scrapeSite('loveliving.uk', 'deep');
    expect(refundCalls(failU)).toEqual([['usage_refund', { p_org: 'org-1', p_resource: 'worker_scrape', p_units: 3, p_day: '2026-10-14' }]]);
  });

  it('scrape keeps only addresses on the domain and phrases the result', async () => {
    const body = {
      emails: [
        { value: 'max@loveliving.uk', sources: ['https://loveliving.uk/team'] },
        { value: 'spam@other.com', sources: ['https://other.com/'] },
      ],
      phones: [],
    };
    const c = make(usage(), worker(200, body));
    const r = await c.scrapeSite('loveliving.uk');
    expect(r).toEqual({ ok: true, value: { emails: [{ value: 'max@loveliving.uk', source: 'https://loveliving.uk/team' }], phones: [] } });
    expect(c.lines()).toContain('Read loveliving.uk with the browser scraper: found 1 address and 0 phone numbers.');
    expect(c.lines().join(' ')).not.toContain('other.com');
  });

  it('orders lines: verify tally, scrape line, then failure lines, without duplicates', async () => {
    const u = usage((n) => (n <= 2 ? { data: ALLOWED, error: null } : { data: REFUSED, error: null }));
    const f = vi.fn<typeof fetch>((input) => {
      const body = String(input).endsWith('/verify-email') ? VERIFY_OK : SCRAPE_OK;
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    });
    const c = make(u, f);
    await c.verifyEmail('max@loveliving.uk');
    await c.scrapeSite('loveliving.uk');
    await c.verifyEmail('max@loveliving.uk'); // refused (3rd reserve)
    await c.verifyEmail('max@loveliving.uk'); // stopped, no duplicate line
    const lines = c.lines();
    expect(lines).toEqual([
      'Checked 1 email address with our own checker (1 valid, 0 not real, 0 could not be confirmed).',
      'Read loveliving.uk with the browser scraper: found 1 address and 0 phone numbers.',
      refusalLine('org_limit', 'worker_verify', 150),
    ]);
  });

  it('aborts a slow call and reports unreachable', async () => {
    vi.useFakeTimers();
    const u = usage();
    let aborted = false;
    const f = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')); });
    }));
    const c = make(u, f);
    const pending = c.verifyEmail('max@loveliving.uk');
    await vi.advanceTimersByTimeAsync(19_999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(aborted).toBe(true);
    const r = await pending;
    expect(r).toEqual({ ok: false, failure: 'unreachable', line: workerFailureLine('unreachable') });
    // our own timeout: the worker may still be running, so the units stay reserved
    expect(refundCalls(u).length).toBe(0);
    expect(reserveCalls(u).length).toBe(1);
    const again = await c.verifyEmail('max@loveliving.uk');
    expect(again).toMatchObject({ ok: false, failure: 'unreachable' });
    expect(reserveCalls(u).length).toBe(1);
  });

  it('refunds once when the network fails fast, before any timeout', async () => {
    vi.useFakeTimers();
    const u = usage();
    const f = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('connection reset')));
    const r = await make(u, f).verifyEmail('max@loveliving.uk');
    expect(r).toMatchObject({ ok: false, failure: 'unreachable' });
    expect(refundCalls(u).length).toBe(1);
  });

  it('with no config, 8 checks give exactly one line: not set up', async () => {
    const c = make(usage(), worker(200, VERIFY_OK), null);
    for (let i = 0; i < 8; i++) await c.verifyEmail('max@loveliving.uk');
    expect(c.lines()).toEqual([workerFailureLine('not_configured')]);
  });

  it('after an unreachable result, later checks stay unreachable with no cap line', async () => {
    const f = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('connect failed')));
    const c = make(usage(), f);
    for (let i = 0; i < 8; i++) {
      expect(await c.verifyEmail('max@loveliving.uk')).toMatchObject({ ok: false, failure: 'unreachable' });
    }
    expect(c.lines()).toEqual([workerFailureLine('unreachable')]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never puts the secret or the worker address into any line', async () => {
    const outcomes: string[] = [];
    const cases: Array<[number | 'reject', unknown]> = [[503, {}], [429, {}], [422, {}], [401, {}], ['reject', null], [200, { junk: true }]];
    for (const [status, body] of cases) {
      const f = status === 'reject'
        ? vi.fn<typeof fetch>(() => Promise.reject(new Error(`boom ${CONFIG.url} ${CONFIG.secret}`)))
        : worker(status, body);
      const c = make(usage(), f);
      await c.verifyEmail('max@loveliving.uk');
      await c.scrapeSite('loveliving.uk');
      outcomes.push(...c.lines());
    }
    const refusedClient = make(usage({ data: REFUSED, error: null }), worker(200, VERIFY_OK));
    await refusedClient.verifyEmail('max@loveliving.uk');
    outcomes.push(...refusedClient.lines());
    const none = make(usage(), worker(200, {}), null);
    await none.scrapeSite('loveliving.uk');
    outcomes.push(...none.lines());

    expect(outcomes.length).toBeGreaterThan(5);
    const all = outcomes.join('\n');
    expect(all).not.toContain('didreamlabs');
    expect(all).not.toContain(CONFIG.secret);
    expect(all).not.toContain('lookup.');
    expect(all).not.toContain('max@loveliving.uk');
  });
});
