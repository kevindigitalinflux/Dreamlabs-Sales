import { fetchWithTimeout } from './fetchWithTimeout.ts';
import { buildPlacesRequest, classifyPlacesError, mapPlacesPage, parsePlacesReservation, placesErrorMessage, placesLimitMessage, shouldUseLegacy, type PlacesResult } from './placesNew.ts';
import type { UsageClient } from './usage.ts';

export interface PlacesContext {
  service: UsageClient; orgId: string; shared: boolean; mode: 'new' | 'legacy';
  onMessage?: (message: string) => void;
  probe?: Promise<void>; probed?: boolean;
}

/** Unknown provenance is conservatively shared until the resolver reports an org key. */
export function createPlacesContext(service: UsageClient, orgId: string): PlacesContext {
  return { service, orgId, shared: true, mode: 'new' };
}

async function newPage(key: string, query: string, token?: string, idsOnly = false) {
  const request = buildPlacesRequest(query, token);
  const res = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': idsOnly ? 'places.id' : request.fieldMask },
    body: JSON.stringify(request.body),
  });
  const body = await res.json();
  if (!res.ok) {
    const kind = classifyPlacesError(res.status, body);
    throw new PlacesError(kind, placesErrorMessage(kind, body));
  }
  return mapPlacesPage(body);
}

export class PlacesError extends Error {
  constructor(readonly kind: string, message: string) { super(message); }
}

/** Existing legacy Text Search protocol, including its pagination delay. */
async function legacyPage(key: string, query: string, token?: string) {
  const url = token
    ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${token}&key=${key}`
    : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetchWithTimeout(url);
  const data = await res.json() as { status?: string; results?: PlacesResult[]; next_page_token?: string };
  if (data.status === 'INVALID_REQUEST' && token) {
    // A too-early next_page_token is a documented, expected possibility —
    // keep whatever we already collected instead of failing the whole job.
    return { results: [], nextPageToken: undefined };
  }
  if (!res.ok || (data.status !== 'OK' && data.status !== 'ZERO_RESULTS')) {
    const kind = data.status === 'OVER_QUERY_LIMIT' ? 'quota' : 'denied';
    throw new PlacesError(kind, placesErrorMessage(kind));
  }
  return { results: data.results ?? [], nextPageToken: data.next_page_token };
}

/** Reserve search events before dispatch; retain attempted requests on uncertain failures. */
export async function searchPlaces(key: string, query: string, opts: { context: PlacesContext; maxPages?: number; cap?: number }) {
  const { context: ctx } = opts;
  const units = Math.min(3, Math.max(1, opts.maxPages ?? 1));
  let reservation;
  try {
    const { data, error } = await ctx.service.rpc('places_reserve', { p_org: ctx.orgId, p_units: units, p_shared: ctx.shared });
    reservation = error ? { ok: false, reason: 'error' } : parsePlacesReservation(data);
  } catch { console.warn('Google Places usage check failed'); reservation = { ok: false, reason: 'error' }; }
  if (!reservation.ok || !reservation.reservation_id) throw new PlacesError('guardrail', placesLimitMessage({ ...reservation, ok: false }));
  let used = 0;
  const results: PlacesResult[] = [];
  let token: string | undefined;
  try {
    for (let page = 0; page < units; page++) {
      if (ctx.probe) await ctx.probe;
      let release: (() => void) | undefined;
      if (!ctx.probed) {
        ctx.probed = true;
        ctx.probe = new Promise<void>(resolve => { release = resolve; });
      }
      used++;
      let data;
      try {
      if (ctx.mode === 'legacy') data = await legacyPage(key, query, token);
      else {
        try { data = await newPage(key, query, token); }
        catch (err) {
          if (!(err instanceof PlacesError) || !shouldUseLegacy(err.kind)) throw err;
          ctx.mode = 'legacy';
          data = await legacyPage(key, query, token);
        }
      }
      } finally { release?.(); }
      results.push(...data.results);
      token = data.nextPageToken;
      if (!token || results.length >= (opts.cap ?? Infinity)) break;
      // Google requires a short delay before a next_page_token becomes valid.
      if (ctx.mode === 'legacy') await new Promise(r => setTimeout(r, 2000));
    }
    return { results, legacy: ctx.mode === 'legacy' };
  } catch (err) {
    // Never propagate network error text: a legacy URL carries a key.
    throw err instanceof PlacesError ? err : new PlacesError('network', placesErrorMessage('network'));
  } finally {
    if (used < units) {
      try {
        const { error } = await ctx.service.rpc('places_refund', { p_org: ctx.orgId, p_units: units - used, p_month: reservation.month, p_reservation: reservation.reservation_id });
        if (error) console.warn('Google Places unused-page refund failed');
      } catch { console.warn('Google Places unused-page refund failed'); }
    }
  }
}

/** Legacy Details remains available only to searches routed through the fallback. */
export async function legacyPlaceDetails(placeId: string, key: string) {
  const res = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=name,formatted_address,address_components,website,formatted_phone_number&key=${key}`);
  if (!res.ok) return null;
  const data = await res.json() as { result?: { name?: string; formatted_address?: string; address_components?: { long_name?: string; types?: string[] }[]; website?: string; formatted_phone_number?: string } };
  return data.result ?? null;
}

/** Free IDs-only validation; no usage reserve and no key in a New API URL. */
export async function validatePlacesKey(key: string): Promise<string | null> {
  try {
    try { await newPage(key, 'test', undefined, true); return null; }
    catch (err) {
      if (!(err instanceof PlacesError) || !shouldUseLegacy(err.kind)) throw err;
      try { await legacyPage(key, 'test'); return null; }
      catch (legacyError) { return legacyError instanceof PlacesError ? `${err.message} ${legacyError.message}` : err.message; }
    }
  } catch (err) { return err instanceof PlacesError ? err.message : placesErrorMessage('network'); }
}
