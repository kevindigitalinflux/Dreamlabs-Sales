import { afterEach, expect, it, vi } from 'vitest';
import { createPlacesContext, searchPlaces, validatePlacesKey } from '../../supabase/functions/_shared/placesClient';

afterEach(() => vi.unstubAllGlobals());
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function context(data: unknown = { ok: true, used: 3, limit: 900, month: '2026-10-01', reservation_id: 'reservation' }) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { ctx: createPlacesContext({ rpc }, 'org'), rpc };
}
it('reserves before any request, sends the key only in a header, refunds unused pages once', async () => {
  const { ctx, rpc } = context();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(rpc).toHaveBeenCalledWith('places_reserve', { p_org: 'org', p_units: 3, p_shared: true });
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init?.headers).toMatchObject({ 'X-Goog-Api-Key': 'test-secret' });
    return response({ places: [{ id: 'a', displayName: { text: 'A' }, websiteUri: 'https://a.example' }] });
  }));
  expect((await searchPlaces('test-secret', 'query', { context: ctx, maxPages: 3 })).results[0].website).toBe('https://a.example');
  expect(rpc).toHaveBeenLastCalledWith('places_refund', expect.objectContaining({ p_units: 2, p_month: '2026-10-01', p_reservation: 'reservation' }));
});
it('fails closed on RPC failure without contacting Google', async () => {
  const { ctx } = context(null);
  vi.stubGlobal('fetch', vi.fn());
  await expect(searchPlaces('secret', 'q', { context: ctx })).rejects.toThrow('usage check is unavailable');
  expect(fetch).not.toHaveBeenCalled();
});
it('follows New page tokens without Details calls', async () => {
  const { ctx } = context();
  const fetcher = vi.fn().mockResolvedValueOnce(response({ places: [], nextPageToken: 'next' })).mockResolvedValueOnce(response({ places: [] }));
  vi.stubGlobal('fetch', fetcher);
  await searchPlaces('secret', 'q', { context: ctx, maxPages: 3 });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ textQuery: 'q', pageSize: 20, languageCode: 'en', pageToken: 'next' });
});
it('remembers disabled New service for the run and keeps the legacy path', async () => {
  const { ctx } = context();
  const fetcher = vi.fn().mockResolvedValueOnce(response({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403))
    .mockImplementation(async () => response({ status: 'ZERO_RESULTS', results: [] }));
  vi.stubGlobal('fetch', fetcher);
  await searchPlaces('secret', 'q', { context: ctx });
  await searchPlaces('secret', 'q2', { context: ctx });
  expect(fetcher.mock.calls.filter(c => c[0].includes('places.googleapis.com'))).toHaveLength(1);
});
it.each([400, 403, 429, 503])('never falls back for HTTP %s', async status => {
  const { ctx } = context();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: { message: 'secret https://invalid?key=secret' } }, status)));
  await expect(searchPlaces('secret', 'q', { context: ctx })).rejects.not.toThrow('secret');
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('validates with IDs only and rejects legacy quota responses', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ places: [] }));
  vi.stubGlobal('fetch', fetcher);
  expect(await validatePlacesKey('secret')).toBeNull();
  expect(fetcher.mock.calls[0][1].headers['X-Goog-FieldMask']).toBe('places.id');
  fetcher.mockResolvedValueOnce(response({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403))
    .mockResolvedValueOnce(response({ status: 'OVER_QUERY_LIMIT' }));
  expect(await validatePlacesKey('secret')).toContain('quota');
});

it('shares one New capability probe across concurrent lookups', async () => {
  const { ctx } = context();
  let probes = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://places.googleapis.com')) {
      probes++;
      await new Promise(resolve => setTimeout(resolve, 5));
      return response({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403);
    }
    return response({ status: 'ZERO_RESULTS' });
  }));
  await Promise.all(Array.from({ length: 8 }, () => searchPlaces('secret', 'q', { context: ctx })));
  expect(probes).toBe(1);
});

it('does not expose network errors, even if they mimic a safe message', async () => {
  const { ctx } = context();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Google https://host?key=secret')));
  await expect(searchPlaces('secret', 'q', { context: ctx })).rejects.toThrow('could not be reached');
});
