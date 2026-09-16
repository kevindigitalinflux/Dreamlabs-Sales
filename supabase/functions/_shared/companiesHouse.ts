import { isFuzzyNameMatch } from './fuzzyMatch.ts';

/**
 * Companies House returns officer names as "SURNAME, Forename Middlename".
 * Reformat to "Forename Middlename SURNAME" so downstream consumers (e.g.
 * templateVars.ts's `owner_name?.split(' ')[0]` for {{first_name}}) get a
 * real first name instead of "SURNAME," with a trailing comma. Falls back to
 * the raw value unchanged if it isn't in the comma-separated format.
 */
export function normalizeOfficerName(rawName: string): string {
  const commaIndex = rawName.indexOf(', ');
  if (commaIndex === -1) return rawName;
  const surname = rawName.slice(0, commaIndex);
  const forenames = rawName.slice(commaIndex + 2);
  return `${forenames} ${surname}`;
}

export async function fetchFirstOfficer(companyNumber: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { name?: string }[] };
    const rawName = data.items?.[0]?.name;
    return rawName ? normalizeOfficerName(rawName) : null;
  } catch {
    return null;
  }
}

/**
 * Searches Companies House by free-text business name, returns the top
 * result only if it plausibly matches — guards against attaching an
 * unrelated company's officer to the wrong lead.
 */
export async function searchCompanyByName(businessName: string, apiKey: string): Promise<{ company_number: string; title: string } | null> {
  try {
    const res = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(businessName)}&items_per_page=1`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: { company_number?: string; title?: string }[] };
    const top = data.items?.[0];
    if (!top?.company_number || !top.title) return null;
    if (!isFuzzyNameMatch(businessName, top.title)) return null;
    return { company_number: top.company_number, title: top.title };
  } catch {
    return null;
  }
}

/**
 * Free, UK-only owner-name lookup for an existing lead: search by business
 * name, then pull its first registered officer. Returns null on no match, no
 * officers, or any provider error — never throws.
 */
export async function lookupCompaniesHouseOfficer(businessName: string, apiKey: string): Promise<string | null> {
  const company = await searchCompanyByName(businessName, apiKey);
  if (!company) return null;
  return fetchFirstOfficer(company.company_number, apiKey);
}
