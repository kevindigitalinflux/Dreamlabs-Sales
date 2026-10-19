import { afterEach, expect, it, vi } from 'vitest';
import { lookupPlaceContact, placeCityMatches, placeMatchStrength } from '../../supabase/functions/_shared/googlePlacesLookup';

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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [
    { place_id: 'weak', name: "Murphy's Bar" }, { place_id: 'strong', name: 'Murphy Plumbing' },
  ] }))).mockResolvedValueOnce(new Response(JSON.stringify({ result: {
    name: 'Murphy Plumbing', formatted_address: '1 High Street, London, UK', address_components: [{ long_name: 'London', types: ['postal_town'] }], website: 'https://murphy.example', formatted_phone_number: '020 7946 0958',
  } }))));
  const result = await lookupPlaceContact('Murphy Plumbing', 'London', 'test-only');
  expect(result).toMatchObject({ strength: 2, cityMatches: true, name: 'Murphy Plumbing', address: '1 High Street, London, UK' });
  expect(vi.mocked(fetch).mock.calls[1][0]).toContain('place_id=strong');
});
