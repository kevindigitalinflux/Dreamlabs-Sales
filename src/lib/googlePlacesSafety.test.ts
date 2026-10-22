import { afterEach, expect, it, vi } from 'vitest';
import { lookupPlaceContact, placeCityMatches, placeMatchStrength } from '../../supabase/functions/_shared/googlePlacesLookup';
import { createPlacesContext } from '../../supabase/functions/_shared/placesClient';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('does not mistake Murphy Plumbing for Murphy’s Bar', () => {
  expect(placeMatchStrength('Murphy Plumbing', "Murphy's Bar")).toBe(1);
  expect(placeMatchStrength('Murphy Plumbing', 'Murphy Plumbing')).toBe(2);
});
it.each([[null, 'London', false], ['London', 'Londonderry', false], ['York', 'New York', false], ['London', 'London Road, Bristol', false], ['London', 'London', true]] as const)('checks city %s against locality %s', (city, address, expected) => {
  expect(placeCityMatches(city, address)).toBe(expected);
});
it('returns actual matched name and address for review and auto-fill decisions', async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'OK', results: [
    { place_id: 'weak', name: "Murphy's Bar" }, { place_id: 'strong', name: 'Murphy Plumbing' },
  ] }))).mockResolvedValueOnce(new Response(JSON.stringify({ result: {
    name: 'Murphy Plumbing', formatted_address: '1 High Street, London, UK', address_components: [{ long_name: 'London', types: ['postal_town'] }], website: 'https://murphy.example', formatted_phone_number: '020 7946 0958',
  } }))));
  const ctx = createPlacesContext({ rpc: async () => ({ data: { ok: true, used: 1, limit: 900, month: '2026-10-01', reservation_id: 'one' }, error: null }) }, 'org');
  ctx.mode = 'legacy';
  const result = await lookupPlaceContact('Murphy Plumbing', 'London', 'test-only', ctx);
  expect(result).toMatchObject({ strength: 2, cityMatches: true, name: 'Murphy Plumbing', address: '1 High Street, London, UK' });
  expect(vi.mocked(fetch).mock.calls[1][0]).toContain('place_id=strong');
});

it('selects the stronger New match with city evidence and never requests Details', async () => {
  const ctx = createPlacesContext({ rpc: async () => ({ data: { ok: true, used: 1, limit: 900, month: '2026-10-01', reservation_id: 'one' }, error: null }) }, 'org');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ places: [
    { id: 'weak', displayName: { text: "Murphy's Bar" }, websiteUri: 'https://bar.example' },
    { id: 'strong', displayName: { text: 'Murphy Plumbing' }, formattedAddress: 'London', nationalPhoneNumber: '020 7946 0958', websiteUri: 'https://murphy.example', addressComponents: [{ longText: 'London', types: ['postal_town'] }] },
  ] }))));
  expect(await lookupPlaceContact('Murphy Plumbing', 'London', 'test-only', ctx)).toMatchObject({ strength: 2, cityMatches: true, website: 'https://murphy.example', phone: '020 7946 0958' });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('skips a capped lookup with a plain step line and no provider request', async () => {
  const ctx = createPlacesContext({ rpc: async () => ({ data: { ok: false, reason: 'org_limit', used: 900, limit: 900, month: '2026-10-01' }, error: null }) }, 'org');
  ctx.onMessage = vi.fn();
  vi.stubGlobal('fetch', vi.fn());
  expect(await lookupPlaceContact('Acme', 'London', 'test-only', ctx)).toBeNull();
  expect(ctx.onMessage).toHaveBeenCalledWith(expect.stringContaining('900 of 900'));
  expect(fetch).not.toHaveBeenCalled();
});
