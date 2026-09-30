// supabase/functions/_shared/googlePlacesLookup.ts
import { fetchWithTimeout } from './fetchWithTimeout.ts';
import { isFuzzyNameMatch } from './fuzzyMatch.ts';

export interface PlaceContact { website: string | null; phone: string | null }

/**
 * Finds a business's website and phone number on Google Places (the same legacy
 * Text Search + Details endpoints the lead scraper already uses, so no new API
 * needs enabling). Bulk enrichment's other steps all start from an existing
 * website, so this is what lets a lead that only has a name (e.g. one created
 * from a walk-in via Dream Agent) get any contact details at all.
 *
 * Guards against attaching another business's details: only one of the top
 * results whose name plausibly matches the lead's is used. Returns null on no
 * match or any error; never throws and never writes anywhere.
 */
export async function lookupPlaceContact(businessName: string, city: string | null, apiKey: string): Promise<PlaceContact | null> {
  try {
    const query = city ? `${businessName} ${city}` : businessName;
    const searchRes = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`,
    );
    if (!searchRes.ok) return null;
    const search = await searchRes.json() as { results?: { place_id?: string; name?: string }[] };
    const match = (search.results ?? []).slice(0, 3).find((r) => r.place_id && r.name && isFuzzyNameMatch(businessName, r.name));
    if (!match?.place_id) return null;

    const detailsRes = await fetchWithTimeout(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(match.place_id)}&fields=website,formatted_phone_number&key=${apiKey}`,
    );
    if (!detailsRes.ok) return null;
    const details = await detailsRes.json() as { result?: { website?: string; formatted_phone_number?: string } };
    const website = details.result?.website ?? null;
    const phone = details.result?.formatted_phone_number ?? null;
    return website || phone ? { website, phone } : null;
  } catch {
    return null;
  }
}
