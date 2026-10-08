// supabase/functions/_shared/googlePlacesLookup.ts
import { fetchWithTimeout } from './fetchWithTimeout.ts';
import { isFuzzyNameMatch } from './fuzzyMatch.ts';

export interface PlaceContact { website: string | null; phone: string | null }

// Words too common in business names to prove two names are the same business.
const GENERIC_TOKENS = new Set([
  'the', 'and', 'ltd', 'limited', 'llc', 'inc', 'plc', 'co', 'company', 'group', 'uk', 'london',
  'services', 'service', 'solutions', 'management', 'property', 'properties', 'estate', 'agents',
  'agency', 'letting', 'lettings', 'residential', 'commercial', 'cleaning', 'studio', 'associates',
]);

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const compact = (s: string) => tokens(s).join('');

/**
 * Whether a Google Places result plausibly is the lead's business. Google spells
 * names differently from how a rep types them ("The Green House" vs "The
 * Greenhouse Ethical Property"), so strict whole-word matching rejected real
 * hits. Accepts if the names match as whole words, OR one name's letters are
 * contained in the other's (ignoring spaces/punctuation; 8+ chars so short names
 * can't match by accident), OR they share a distinctive word. The user still
 * reviews every proposed value before it is applied.
 */
export function placeNameMatches(leadName: string, placeName: string): boolean {
  return placeMatchStrength(leadName, placeName) > 0;
}

/** 2 = same name (whole words, or same letters ignoring spacing); 1 = shares a distinctive word only; 0 = no match. */
export function placeMatchStrength(leadName: string, placeName: string): 0 | 1 | 2 {
  if (isFuzzyNameMatch(leadName, placeName)) return 2;
  const a = compact(leadName);
  const b = compact(placeName);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 8 && longer.includes(shorter)) return 2;
  const distinctive = new Set(tokens(leadName).filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t)));
  return tokens(placeName).some((t) => distinctive.has(t)) ? 1 : 0;
}

/**
 * Finds a business's website and phone number on Google Places (the same legacy
 * Text Search + Details endpoints the lead scraper already uses, so no new API
 * needs enabling). Bulk enrichment's other steps all start from an existing
 * website, so this is what lets a lead that only has a name (e.g. one created
 * from a walk-in via Dream Agent) get any contact details at all.
 *
 * Only one of the top results whose name plausibly matches the lead's is used.
 * Returns null on no match or any error; never throws and never writes anywhere.
 * Logs what Google answered (names and API status only, never the key) so a
 * "found nothing" result can be diagnosed from the function logs.
 */
export async function lookupPlaceContact(businessName: string, city: string | null, apiKey: string): Promise<PlaceContact | null> {
  try {
    const query = city ? `${businessName} ${city}` : businessName;
    const searchRes = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`,
    );
    if (!searchRes.ok) { console.warn(`places search HTTP ${searchRes.status} for "${query}"`); return null; }
    const search = await searchRes.json() as { status?: string; error_message?: string; results?: { place_id?: string; name?: string }[] };
    const top = (search.results ?? []).slice(0, 3);
    console.log(`places search "${query}": status=${search.status ?? '?'}${search.error_message ? ` (${search.error_message})` : ''} top=[${top.map((r) => r.name).join(' | ')}]`);
    // Prefer a genuinely same-named result over one that only shares a word, even
    // if the latter ranked higher.
    const named = top.filter((r) => r.place_id && r.name);
    const match = named.find((r) => placeMatchStrength(businessName, r.name!) === 2)
      ?? named.find((r) => placeMatchStrength(businessName, r.name!) === 1);
    if (!match?.place_id) return null;

    const detailsRes = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(match.place_id)}&fields=website,formatted_phone_number&key=${apiKey}`,
    );
    if (!detailsRes.ok) { console.warn(`places details HTTP ${detailsRes.status} for "${match.name}"`); return null; }
    const details = await detailsRes.json() as { status?: string; result?: { website?: string; formatted_phone_number?: string } };
    const website = details.result?.website ?? null;
    const phone = details.result?.formatted_phone_number ?? null;
    console.log(`places details "${match.name}": status=${details.status ?? '?'} website=${website ? 'yes' : 'no'} phone=${phone ? 'yes' : 'no'}`);
    return website || phone ? { website, phone } : null;
  } catch {
    // Never log the error text: Deno network errors can include the request URL, which carries the API key.
    console.warn('places lookup failed (network error or timeout)');
    return null;
  }
}
