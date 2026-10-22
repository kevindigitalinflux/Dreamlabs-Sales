import { describe, expect, it } from 'vitest';
import { buildPlacesRequest, mapPlacesPage, classifyPlacesError, shouldUseLegacy, pacificMonth, placesLimitMessage, parsePlacesReservation } from '../../supabase/functions/_shared/placesNew';

describe('Places New wire contract', () => {
  it('requests Enterprise search fields without Atmosphere or Details', () => {
    const request = buildPlacesRequest('plumbers London', 'second');
    expect(request.fieldMask).toBe('places.id,places.displayName,places.formattedAddress,places.addressComponents,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,nextPageToken');
    expect(request.body).toEqual({ textQuery: 'plumbers London', pageSize: 20, languageCode: 'en', pageToken: 'second' });
    expect(buildPlacesRequest('test').body).not.toHaveProperty('pageToken');
  });
  it('maps identity, Enterprise fields, national phone and city components', () => {
    expect(mapPlacesPage({ places: [{ id: 'one', displayName: { text: 'Acme' }, formattedAddress: 'London', rating: 4.5, userRatingCount: 12, nationalPhoneNumber: '020 7946 0958', websiteUri: 'https://acme.example', addressComponents: [{ longText: 'London', types: ['postal_town'] }] }], nextPageToken: 'next' })).toEqual({ results: [{ place_id: 'one', name: 'Acme', formatted_address: 'London', rating: 4.5, user_ratings_total: 12, phone: '020 7946 0958', website: 'https://acme.example', address_components: [{ long_name: 'London', types: ['postal_town'] }] }], nextPageToken: 'next' });
  });
  it('handles missing data and ignores unusable identities', () => {
    expect(mapPlacesPage({ places: [{}, { id: 'x', displayName: { text: 'X' } }] })).toEqual({ results: [{ place_id: 'x', name: 'X', phone: null, website: null, address_components: [] }], nextPageToken: undefined });
    expect(mapPlacesPage({})).toEqual({ results: [], nextPageToken: undefined });
  });
});

it.each([
  [403, { error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 'not_enabled'],
  [403, { error: { details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }] } }, 'not_enabled'],
  [403, { error: { message: 'API has not been used in project 123' } }, 'not_enabled'],
  [403, { error: { message: 'Billing not enabled' } }, 'denied'],
  [400, { error: { message: 'API key not valid' } }, 'denied'],
  [429, {}, 'quota'], [403, { error: { status: 'RESOURCE_EXHAUSTED' } }, 'quota'],
  [400, {}, 'bad_request'], [503, {}, 'network'],
] as const)('classifies HTTP %s %j', (status, body, expected) => {
  expect(classifyPlacesError(status, body)).toBe(expected);
  expect(shouldUseLegacy(expected)).toBe(expected === 'not_enabled');
});

it.each([
  ['2026-11-01T06:59:59Z', '2026-10-01'], ['2026-11-01T07:00:00Z', '2026-11-01'],
  ['2026-03-01T07:59:59Z', '2026-02-01'], ['2026-03-01T08:00:00Z', '2026-03-01'],
])('uses Pacific calendar month at %s', (instant, month) => expect(pacificMonth(new Date(instant))).toBe(month));

it('fails closed on malformed reserves and reports reset date', () => {
  for (const value of [null, {}, { ok: true }, { ok: true, month: '2026-10-01', used: -1, limit: 900 }]) expect(parsePlacesReservation(value).ok).toBe(false);
  expect(parsePlacesReservation({ ok: true, month: '2026-10-01', used: 3, limit: 900 })).toMatchObject({ ok: true, month: '2026-10-01' });
  expect(placesLimitMessage({ ok: false, reason: 'org_limit', used: 900, limit: 900, month: '2026-10-01' })).toContain('900 of 900');
  expect(placesLimitMessage({ ok: false, reason: 'org_limit', used: 900, limit: 900, month: '2026-10-01' })).toContain('1 November');
});
