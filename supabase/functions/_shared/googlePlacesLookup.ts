// supabase/functions/_shared/googlePlacesLookup.ts
import { searchPlaces, legacyPlaceDetails, PlacesError, type PlacesContext } from './placesClient.ts';
import { isFuzzyNameMatch } from './fuzzyMatch.ts';

export interface PlaceContact { website: string | null; phone: string | null; name: string; address: string; strength: 0 | 1 | 2; cityMatches: boolean }

/** Exact returned locality/postal town, never a street name or the search query. */
export function placeCityMatches(city: string | null, placeCity: string): boolean {
  const words = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return !!city?.trim() && words(placeCity) === words(city);
}

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
 * Finds a business's website and phone number with Enterprise Text Search (New),
 * retaining legacy Text Search + Details for projects where New is not enabled.
 * Bulk enrichment's other steps all start from an existing
 * website, so this is what lets a lead that only has a name (e.g. one created
 * from a walk-in via Dream Agent) get any contact details at all.
 *
 * Only one of the top results whose name plausibly matches the lead's is used.
 * Returns null on no match or any error; never throws and never writes anywhere.
 * Emits only fixed error messages, never provider text, keys or request URLs.
 */
export async function lookupPlaceContact(businessName: string, city: string | null, apiKey: string, context?: PlacesContext): Promise<PlaceContact | null> {
  if (!context) { console.warn('Google Places skipped: no usage context'); return null; }
  try {
    const query = city ? businessName + ' ' + city : businessName;
    const search = await searchPlaces(apiKey, query, { context });
    const named = search.results.slice(0, 3).filter(r => r.place_id && r.name);
    // Prefer a genuinely same-named result over one that only shares a word, even
    // if the latter ranked higher.
    const match = named.find(r => placeMatchStrength(businessName, r.name) === 2)
      ?? named.find(r => placeMatchStrength(businessName, r.name) === 1);
    if (!match) return null;
    const details = search.legacy ? await legacyPlaceDetails(match.place_id, apiKey) : null;
    const website = search.legacy ? details?.website ?? null : match.website;
    const phone = search.legacy ? details?.formatted_phone_number ?? null : match.phone;
    const name = details?.name ?? match.name;
    const address = details?.formatted_address ?? match.formatted_address ?? '';
    const cityMatches = (details?.address_components ?? match.address_components ?? []).some(c =>
      c.types?.some(type => type === 'locality' || type === 'postal_town') && placeCityMatches(city, c.long_name ?? ''));
    return website || phone ? { website, phone, name, address, strength: placeMatchStrength(businessName, name), cityMatches } : null;
  } catch (err) {
    // Never log the error text: Deno network errors can include the request URL, which carries the API key.
    console.warn('places lookup failed (provider or usage check)');
    // Only searchPlaces creates these safe messages; Details errors are suppressed.
    if (err instanceof PlacesError) context.onMessage?.(err.message);
    else context.onMessage?.('Google Places could not complete this lookup. Check the key, billing and quota in Organization settings.');
    return null;
  }
}
