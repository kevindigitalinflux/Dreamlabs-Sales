// supabase/functions/_shared/registryContacts.ts
import { lookupPlaceContact } from './googlePlacesLookup.ts';
import { scrapeWebsiteContact } from './websiteContact.ts';

export interface CompanyContacts { website: string | null; email: string | null; phone: string | null }

const EMPTY: CompanyContacts = { website: null, email: null, phone: null };
/** Hard ceiling per company so a slow site cannot eat the edge function's time budget. */
const LOOKUP_TIMEOUT_MS = 12000;

async function lookup(input: { business_name: string; city: string | null }, googlePlaces: string | null): Promise<CompanyContacts> {
  let website: string | null = null;
  let phone: string | null = null;
  if (googlePlaces) {
    const place = await lookupPlaceContact(input.business_name, input.city, googlePlaces);
    website = place?.website ?? null;
    phone = place?.phone ?? null;
  }
  // scrapeWebsiteContact applies the SSRF guard (parseSafeWebsiteUrl) and returns nulls for no/unsafe site.
  const site = await scrapeWebsiteContact(website);
  return { website, email: site.email ?? null, phone: phone ?? site.phone ?? null };
}

/**
 * Finds a registry company's own website, email and phone: Google Places text
 * search for website/phone (when a key exists), then a website scrape for
 * email/phone. Returns only what was found. Never throws; all null on failure
 * or timeout. These are company contacts only, never officers' personal details.
 */
export async function lookupCompanyContacts(
  input: { business_name: string; city: string | null },
  keys: { googlePlaces: string | null },
): Promise<CompanyContacts> {
  try {
    const timeout = new Promise<CompanyContacts>((resolve) => setTimeout(() => resolve(EMPTY), LOOKUP_TIMEOUT_MS));
    return await Promise.race([lookup(input, keys.googlePlaces), timeout]);
  } catch {
    return EMPTY;
  }
}
