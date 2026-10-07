// supabase/functions/_shared/enrichLead.ts
// Moved unchanged from enrich-leads-bulk/index.ts so the selected-leads autopilot can reuse it.
import { scrapeWebsiteContact } from './websiteContact.ts';
import { lookupCompaniesHouseOfficer } from './companiesHouse.ts';
import { lookupOpenCorporatesOfficer } from './openCorporates.ts';
import { lookupApolloPhone, lookupHunterEmail, lookupHunterOwnerEmail } from './apolloHunterLookup.ts';
import { lookupPlaceContact } from './googlePlacesLookup.ts';

export interface EnrichLeadRow {
  id: string; org_id: string; business_name: string;
  website: string | null; email: string | null; phone: string | null; owner_name: string | null; city: string | null;
}

// Deno copy of src/types/index.ts's EnrichableField/EnrichmentResult — keep
// the two in sync (same convention as templateVars.ts's Deno/browser split).
export type EnrichField = 'email' | 'phone' | 'owner_name' | 'website';

export interface EnrichResult {
  lead_id: string;
  proposed: Partial<Record<EnrichField, string>>;
  source: Partial<Record<EnrichField, string>>;
}

export interface EnrichKeys { companiesHouse: string | null; openCorporates: string | null; apollo: string | null; hunter: string | null; googlePlaces: string | null }

/** Proposes missing contact details for one lead (website scrape, registry officer, paid keys when present). Writes nothing. */
export async function enrichOneLead(
  lead: EnrichLeadRow,
  keys: EnrichKeys,
): Promise<EnrichResult | null> {
  const proposed: Partial<Record<EnrichField, string>> = {};
  const source: Partial<Record<EnrichField, string>> = {};

  // 0. Google Places — finds the website (and phone) for a lead that only has a
  // name, e.g. one created from a walk-in. Every later step keys off the website,
  // so without this a name-only lead got nothing beyond the Companies House owner.
  let website = lead.website;
  if ((!website || !lead.phone) && keys.googlePlaces) {
    const place = await lookupPlaceContact(lead.business_name, lead.city, keys.googlePlaces);
    if (place?.website && !website) { proposed.website = place.website; source.website = 'google_places'; website = place.website; }
    if (place?.phone && !lead.phone) { proposed.phone = place.phone; source.phone = 'google_places'; }
  }

  // 1. Website scrape — free, no key required.
  const { email: siteEmail, phone: sitePhone } = await scrapeWebsiteContact(website);
  if (siteEmail && siteEmail !== lead.email) { proposed.email = siteEmail; source.email = 'website'; }
  if (sitePhone && sitePhone !== lead.phone && !proposed.phone) { proposed.phone = sitePhone; source.phone = 'website'; }

  // 2. Companies House (UK) — free registration. Skip if the lead already has an owner_name.
  if (!lead.owner_name && keys.companiesHouse) {
    const officer = await lookupCompaniesHouseOfficer(lead.business_name, keys.companiesHouse);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'companies_house'; }
  }

  // 3. OpenCorporates (non-UK best-effort) — only if Companies House found nothing AND the lead has no owner_name.
  if (!proposed.owner_name && !lead.owner_name && keys.openCorporates) {
    const officer = await lookupOpenCorporatesOfficer(lead.business_name, keys.openCorporates);
    if (officer && officer !== lead.owner_name) { proposed.owner_name = officer; source.owner_name = 'opencorporates'; }
  }

  // 4. Apollo/Hunter — paid, opt-in, only for fields still blank after 1–3 AND not already on the lead.
  // The owner's own address first when we know their name (from the lead or step 2),
  // then whatever Hunter has best for the domain.
  if (!proposed.email && !lead.email && keys.hunter && website) {
    const ownerName = proposed.owner_name ?? lead.owner_name;
    const ownerEmail = ownerName ? await lookupHunterOwnerEmail(website, ownerName, keys.hunter) : null;
    const email = ownerEmail ?? await lookupHunterEmail(website, keys.hunter);
    if (email && email !== lead.email) { proposed.email = email; source.email = 'hunter'; }
  }
  if (!proposed.phone && !lead.phone && keys.apollo && website) {
    const phone = await lookupApolloPhone(website, keys.apollo);
    if (phone && phone !== lead.phone) { proposed.phone = phone; source.phone = 'apollo'; }
  }

  if (Object.keys(proposed).length === 0) return null;
  return { lead_id: lead.id, proposed, source };
}
