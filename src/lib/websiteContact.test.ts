import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrapeWebsiteContact } from '../../supabase/functions/_shared/websiteContact';

const EMPTY = { email: null, phone: null };
const redirect = (location?: string) =>
  new Response(null, { status: 302, headers: location === undefined ? {} : { location } });
const page = (html = '<a href="mailto:hi@acme.co.uk">x</a> <a href="tel:+442079460958">y</a>') =>
  new Response(html, { status: 200 });

function stubFetch(responses: Array<() => Response>) {
  const fn = vi.fn(async (_url: unknown, _init?: unknown) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return next();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
const calls = (fn: ReturnType<typeof stubFetch>) => fn.mock.calls.map((c) => String(c[0]));

afterEach(() => vi.unstubAllGlobals());

describe('scrapeWebsiteContact redirects', () => {
  it.each(['http://169.254.169.254/latest/', 'http://localhost/', 'http://[::1]/', 'http://10.0.0.5/x'])(
    'does not follow a redirect to %s', async (target) => {
      const fn = stubFetch([() => redirect(target)]);
      expect(await scrapeWebsiteContact('https://example.com')).toEqual(EMPTY);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(calls(fn).some((u) => u.includes(new URL(target).host))).toBe(false);
    });

  it('follows a redirect to a public host and parses the final page', async () => {
    const fn = stubFetch([() => redirect('https://www.acme.co.uk/'), () => page()]);
    expect(await scrapeWebsiteContact('https://example.com')).toEqual({ email: 'hi@acme.co.uk', phone: '+442079460958' });
    expect(calls(fn)).toEqual(['https://example.com/', 'https://www.acme.co.uk/']);
  });

  it('resolves a relative Location against the current URL', async () => {
    const fn = stubFetch([() => redirect('/contact'), () => page()]);
    await scrapeWebsiteContact('https://example.com/a/b');
    expect(calls(fn)[1]).toBe('https://example.com/contact');
  });

  it('follows http -> https to a public host', async () => {
    stubFetch([() => redirect('https://example.com/'), () => page()]);
    expect((await scrapeWebsiteContact('http://example.com')).email).toBe('hi@acme.co.uk');
  });

  it('follows exactly 3 redirects, then returns empty on the 4th', async () => {
    const fn3 = stubFetch([() => redirect('/1'), () => redirect('/2'), () => redirect('/3'), () => page()]);
    expect((await scrapeWebsiteContact('https://example.com')).email).toBe('hi@acme.co.uk');
    expect(fn3).toHaveBeenCalledTimes(4);
    const fn4 = stubFetch([() => redirect('/1'), () => redirect('/2'), () => redirect('/3'), () => redirect('/4')]);
    expect(await scrapeWebsiteContact('https://example.com')).toEqual(EMPTY);
    expect(fn4).toHaveBeenCalledTimes(4);
  });

  it('returns empty for a 3xx without Location', async () => {
    const fn = stubFetch([() => redirect()]);
    expect(await scrapeWebsiteContact('https://example.com')).toEqual(EMPTY);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('ends a redirect loop after at most 4 requests', async () => {
    const fn = vi.fn(async (u: unknown) => redirect(String(u).endsWith('/a') ? 'https://example.com/b' : 'https://example.com/a'));
    vi.stubGlobal('fetch', fn);
    expect(await scrapeWebsiteContact('https://example.com/a')).toEqual(EMPTY);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('makes no request for a blocked first URL', async () => {
    const fn = stubFetch([]);
    expect(await scrapeWebsiteContact('http://169.254.169.254/')).toEqual(EMPTY);
    expect(fn).not.toHaveBeenCalled();
  });

  it('blocks credentials in Location', async () => {
    const fn = stubFetch([() => redirect('https://user:pw@example.org/')]);
    expect(await scrapeWebsiteContact('https://example.com')).toEqual(EMPTY);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns empty for a non-ok final response', async () => {
    stubFetch([() => new Response('nope', { status: 404 })]);
    expect(await scrapeWebsiteContact('https://example.com')).toEqual(EMPTY);
  });

  it('reads at most ~300 KB of the body', async () => {
    const big = 'a'.repeat(400_000) + ' late@acme.co.uk';
    stubFetch([() => page(big)]);
    expect((await scrapeWebsiteContact('https://example.com')).email).toBeNull();
  });
});
