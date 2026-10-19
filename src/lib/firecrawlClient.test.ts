import { describe, expect, it, vi } from 'vitest';
import { makeFirecrawlClient, validateFirecrawlKey } from '../../supabase/functions/_shared/firecrawlClient';
const reply = () => Response.json({ success: true, data: { rawHtml: '<p>Jane Smith, Director</p>' } });
const setup = (key: string | null = 'fake-test-only') => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => reply());
  const reserve = vi.fn(async () => true);
  return { request, reserve, client: makeFirecrawlClient({ key, request, reserve }) };
};
describe('Firecrawl client', () => {
  it('Extra high reserves at most two distinct pages, including after a charged failure', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 500 })).mockImplementation(async () => reply());
    const reserve = vi.fn(async () => true);
    const client = makeFirecrawlClient({ key: 'fake', request, reserve, maxPages: 2 });
    const pages = ['<a href="/team">Team</a><a href="/about">About</a>'];
    await client.readTeam('example.com', pages, 70_000);
    await client.readTeam('example.com', pages, 70_000);
    await client.readTeam('example.com', pages, 70_000);
    expect(request).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([,options]) => JSON.parse(options!.body as string).url)).toEqual(['https://example.com/team', 'https://example.com/about']);
    expect(client.pagesUsed()).toBe(2);
  });
  it('reserves before one request, reports one page, and refuses a second attempt', async () => {
    const { client, request, reserve } = setup();
    expect(await client.readTeam('example.com', ['<a href="/team">Team</a>'], 70_000)).toMatchObject({ people: [{ name: 'Jane Smith', role: 'Director' }] });
    expect(reserve.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]!);
    expect(client.pagesUsed()).toBe(1);
    expect(await client.readTeam('example.com', [], 70_000)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    const [endpoint, options] = request.mock.calls[0]!;
    expect(endpoint).toBe('https://api.firecrawl.dev/v2/scrape');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer fake-test-only' } });
    const body = JSON.parse(options!.body as string);
    expect(body).toMatchObject({ url: 'https://example.com/team', formats: ['rawHtml'], skipTlsVerification: false });
    expect(body.timeout).toBeGreaterThanOrEqual(10_000);
    expect(body.timeout).toBeLessThanOrEqual(11_000);
  });
  it('does not call the network without a key, safe domain or time reserve', async () => {
    const absent = setup(null);
    expect(absent.client.lines()).toEqual([]);
    expect(await absent.client.readTeam('example.com', [], 70_000)).toBeNull();
    expect(absent.client.lines()).toEqual(['Firecrawl is not set up for this organisation.']);
    expect(absent.reserve).not.toHaveBeenCalled(); expect(absent.request).not.toHaveBeenCalled();
    const unsafe = setup(); await unsafe.client.readTeam('127.0.0.1', [], 70_000);
    expect(unsafe.reserve).not.toHaveBeenCalled();
    const late = setup(); await late.client.readTeam('example.com', [], 20_000);
    expect(late.reserve).not.toHaveBeenCalled();
  });
  it('fails closed when the daily reservation refuses or throws', async () => {
    const f = setup(); f.reserve.mockResolvedValue(false);
    await f.client.readTeam('example.com', [], 70_000);
    expect(f.request).not.toHaveBeenCalled(); expect(f.client.lines().join(' ')).toContain('daily limit');
    const g = setup(); g.reserve.mockRejectedValue(new Error('private-db-payload'));
    await g.client.readTeam('example.com', [], 70_000);
    expect(g.request).not.toHaveBeenCalled(); expect(g.client.lines().join(' ')).not.toContain('private');
  });
  it('never returns raw provider failures and does not retry failed charged requests', async () => {
    const f = setup(); f.request.mockRejectedValue(new Error('private-provider-payload'));
    await f.client.readTeam('example.com', [], 70_000);
    await f.client.readTeam('example.com', [], 70_000);
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.client.pagesUsed()).toBe(1);
    expect(f.client.lines().join(' ')).not.toContain('private');
  });
  it('caps the streamed reply and rejects off-domain metadata', async () => {
    const f = setup(); f.request.mockResolvedValue(Response.json({ success: true, data: { rawHtml: '<p>Jane Smith, Director</p>', metadata: { url: 'https://evil.com' } } }));
    expect(await f.client.readTeam('example.com', [], 70_000)).toBeNull();
    const g = setup(); g.request.mockResolvedValue(new Response('x'.repeat(650_000)));
    expect(await g.client.readTeam('example.com', [], 70_000)).toBeNull();
    expect(g.client.lines().join(' ')).toContain('could not be read');
  });
  it.each([401, 402, 429, 503])('uses fixed problem lines for HTTP %s, never response text', async (status) => {
    const f = setup(); f.request.mockResolvedValue(new Response('private-provider-payload', { status }));
    expect(await f.client.readTeam('example.com', [], 70_000)).toBeNull();
    expect(f.client.lines().join(' ')).toContain(String(status));
    expect(f.client.lines().join(' ')).not.toContain('private-provider');
  });
  it('validates using a read-only credit call, never a paid scrape, and rejects malformed success', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, data: { remainingCredits: 0 } }));
    expect(await validateFirecrawlKey('fake', request)).toBeNull();
    expect(request).toHaveBeenCalledWith('https://api.firecrawl.dev/v2/team/credit-usage', expect.objectContaining({ method: 'GET', redirect: 'error' }));
    request.mockResolvedValue(Response.json({ success: true }));
    expect(await validateFirecrawlKey('fake', request)).toContain('could not be verified');
    request.mockRejectedValue(new Error('fake-private-error'));
    expect(await validateFirecrawlKey('fake', request)).not.toContain('fake-private');
  });
  it('rechecks remaining time after slow reservations and never starts a late scrape', async () => {
    vi.useFakeTimers();
    try {
      const f = setup();
      f.reserve.mockImplementation(async () => { vi.setSystemTime(Date.now() + 40_000); return true; });
      expect(await f.client.readTeam('example.com', [], 70_000)).toBeNull();
      expect(f.request).not.toHaveBeenCalled(); expect(f.client.pagesUsed()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('preserves cancellation/access failures from the checkpoint, before network use', async () => {
    const request = vi.fn<typeof fetch>();
    const reserve = vi.fn(async () => true);
    const client = makeFirecrawlClient({ key: 'fake', request, reserve, checkpoint: async () => { throw new Error('stopped'); } });
    await expect(client.readTeam('example.com', [], 70_000)).rejects.toThrow('stopped');
    expect(request).not.toHaveBeenCalled(); expect(reserve).not.toHaveBeenCalled();
  });
});

it.each(['validation', 'reserve', 'request', 'json'])('logs only fixed context for a Firecrawl %s exception', async (stage) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const fail = async () => { throw new Error('private-URL-key'); };
    if (stage === 'validation') await validateFirecrawlKey('fake', fail);
    else {
      const c = makeFirecrawlClient({ key: 'fake', reserve: stage === 'reserve' ? fail : async () => true,
        request: stage === 'request' ? fail : async () => new Response('{invalid JSON') });
      await c.readTeam('example.com', [], 70_000);
    }
    expect(log.mock.calls).toHaveLength(1);
    expect(log.mock.calls[0]).toHaveLength(1);
    expect(log.mock.calls[0][0]).toMatch(/^firecrawl: /);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private');
  } finally { log.mockRestore(); }
});
it('keeps non-owner people visible in plain step text', async () => {
  const request = async () => Response.json({ success: true, data: { rawHtml: '<script type="application/ld+json">{"@type":"Person","name":"Alice Smith","jobTitle":"Marketing Manager"}</script>' } });
  const client = makeFirecrawlClient({ key: 'fake', reserve: async () => true, request });
  await client.readTeam('example.com', [], 70_000);
  expect(client.lines().join(' ')).toContain('Alice Smith (Marketing Manager)');
});
