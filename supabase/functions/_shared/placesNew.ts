/** Exact Enterprise Text Search fields; never request Atmosphere fields. */
export function buildPlacesRequest(query: string, pageToken?: string) {
  return {
    fieldMask: 'places.id,places.displayName,places.formattedAddress,places.addressComponents,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,nextPageToken',
    body: { textQuery: query, pageSize: 20, languageCode: 'en', ...(pageToken ? { pageToken } : {}) },
  };
}

export interface PlacesResult {
  place_id: string; name: string; formatted_address?: string; rating?: number; user_ratings_total?: number;
  phone: string | null; website: string | null;
  address_components: { long_name?: string; types?: string[] }[];
}
interface NewPage {
  places?: { id?: string; displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number;
    nationalPhoneNumber?: string; websiteUri?: string; addressComponents?: { longText?: string; types?: string[] }[] }[];
  nextPageToken?: string;
}

/** Map New fields into the existing lead/contact shapes. */
export function mapPlacesPage(page: NewPage): { results: PlacesResult[]; nextPageToken?: string } {
  return { results: (page.places ?? []).flatMap(p => p.id && p.displayName?.text ? [{
    place_id: p.id, name: p.displayName.text,
    ...(p.formattedAddress !== undefined ? { formatted_address: p.formattedAddress } : {}),
    ...(p.rating !== undefined ? { rating: p.rating } : {}),
    ...(p.userRatingCount !== undefined ? { user_ratings_total: p.userRatingCount } : {}),
    phone: p.nationalPhoneNumber ?? null, website: p.websiteUri ?? null,
    address_components: (p.addressComponents ?? []).map(c => ({ long_name: c.longText, types: c.types })),
  }] : []), nextPageToken: page.nextPageToken || undefined };
}

export type PlacesErrorKind = 'not_enabled' | 'denied' | 'quota' | 'bad_request' | 'network';

/** Classify structured Google reasons before generic HTTP statuses. */
export function classifyPlacesError(status: number, body: unknown): PlacesErrorKind {
  const text = JSON.stringify(body ?? {}).toLowerCase();
  if (status === 429 || text.includes('resource_exhausted')) return 'quota';
  if (status === 403 && /service_disabled|api_key_service_blocked|has not been used/.test(text)) return 'not_enabled';
  if (status === 403 || (status === 400 && /api.key|invalid.key/.test(text))) return 'denied';
  return status === 400 ? 'bad_request' : 'network';
}

/** Fallback is safe only when the New service is unavailable to this project. */
export function shouldUseLegacy(kind: string): boolean { return kind === 'not_enabled'; }

/** Google's billing month follows Pacific time, including daylight saving. */
export function pacificMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-01`;
}

export interface PlacesReservation { ok: boolean; reason?: string; month?: string; used?: number; limit?: number; reservation_id?: string }

/** Reject incomplete or malformed successful RPC responses. */
export function parsePlacesReservation(value: unknown): PlacesReservation {
  if (!value || typeof value !== 'object') return { ok: false, reason: 'error' };
  const r = value as PlacesReservation;
  if (typeof r.ok !== 'boolean' || !r.month || !/^\d{4}-\d{2}-01$/.test(r.month)
    || !Number.isInteger(r.used) || r.used! < 0 || !Number.isInteger(r.limit) || r.limit! < 0) return { ok: false, reason: 'error' };
  return r;
}

/** Plain cap message shared by scraper failures and enrichment step lines. */
export function placesLimitMessage(r: PlacesReservation): string {
  if (r.reason !== 'org_limit' && r.reason !== 'shared_pool') return 'Google Places skipped: the monthly usage check is unavailable. Try again later.';
  const month = new Date(`${r.month}T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + 1);
  const reset = month.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `Monthly Google Places ${r.reason === 'shared_pool' ? 'shared ' : ''}limit reached (${r.used} of ${r.limit}). It resets on ${reset}. An admin can raise the limit in Organization settings.`;
}

/** Never copy raw provider errors: they can contain keys, URLs or request data. */
export function placesErrorMessage(kind: PlacesErrorKind, body?: unknown): string {
  const text = JSON.stringify(body ?? {}).toLowerCase();
  if (/billing/.test(text)) return 'Google says billing is not enabled. Link a billing account to this Google Cloud project.';
  if (/referer|referrer|ip_address|android|ios/.test(text)) return 'Google says this key is restricted to other websites or apps. Use a server key restricted to Places API (New).';
  if (kind === 'not_enabled') return 'Google says Places API (New) is disabled or this key is restricted to other APIs. Enable it in the Google Cloud library, allow it on the key, and wait two minutes.';
  if (kind === 'quota') return 'Google Places quota reached. Check the quota and billing limits in Google Cloud.';
  if (kind === 'denied') return 'Google rejected the key. Check that it is valid and permits Places API (New) from a server.';
  if (kind === 'bad_request') return 'Google could not read this Places search request.';
  return 'Google Places could not be reached. Try again later.';
}
