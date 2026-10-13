import { isFuzzyNameMatch } from './fuzzyMatch.ts';
import { fetchWithTimeout } from './fetchWithTimeout.ts';
import { mapCompaniesHouseOfficers } from './registryOfficers.ts';
import type { RegistryOfficer } from './registryOfficers.ts';
import { brandTokens } from './domainDiscovery.ts';

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
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
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
 * Active, non-corporate officers of a company as decision-maker candidates
 * (directors first, max 5). Returns [] on any error — never throws.
 */
export async function fetchActiveOfficers(companyNumber: string, apiKey: string): Promise<RegistryOfficer[]> {
  try {
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/company/${companyNumber}/officers`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return [];
    const data = await res.json() as { items?: { name?: string; officer_role?: string; resigned_on?: string }[] };
    return mapCompaniesHouseOfficers(data.items ?? []);
  } catch {
    return [];
  }
}

/**
 * Searches Companies House by free-text business name, returns the top
 * result only if it plausibly matches — guards against attaching an
 * unrelated company's officer to the wrong lead.
 */
export async function searchCompanyByName(businessName: string, apiKey: string): Promise<{ company_number: string; title: string } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(businessName)}&items_per_page=1`, {
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

/** UK postcode key: letters and digits only, uppercase. */
function postcodeKey(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

/**
 * Picks the registered company that IS this lead from Companies House search items: an active company whose
 * registered postcode equals the lead's postcode AND whose name contains every distinctive word of the lead's name.
 * Exactly one such company must exist (two means nothing is picked). Every field of the reply is type-checked.
 */
export function pickRegisteredCompany(items: unknown, leadName: string, leadPostcode: string | null): { company_number: string; title: string } | null {
  const pc = postcodeKey(leadPostcode);
  const brand = brandTokens(leadName);
  if (!Array.isArray(items) || pc.length < 5 || brand.length === 0) return null;
  const hits: { company_number: string; title: string }[] = [];
  for (const raw of items.slice(0, 20)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const i = raw as Record<string, unknown>;
    const number = typeof i.company_number === 'string' && /^[A-Z0-9]{6,10}$/i.test(i.company_number) ? i.company_number : null;
    const title = typeof i.title === 'string' && i.title.length <= 200 ? i.title : null;
    const address = (typeof i.address === 'object' && i.address !== null ? i.address : {}) as Record<string, unknown>;
    if (!number || !title || (typeof i.company_status === 'string' && i.company_status !== 'active')) continue;
    if (postcodeKey(address.postal_code) !== pc) continue;
    const words = brandTokens(title);
    if (brand.every((t) => words.includes(t))) hits.push({ company_number: number, title });
  }
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * Finds the lead's registered company by name, accepted only with a matching registered postcode (see
 * pickRegisteredCompany). The key is sent in the Authorization header. Returns null on no match or any error.
 */
export async function findRegisteredCompany(businessName: string, postcode: string | null, apiKey: string): Promise<{ company_number: string; title: string } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(businessName.slice(0, 120))}&items_per_page=10`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: unknown };
    return pickRegisteredCompany(data?.items, businessName, postcode);
  } catch {
    return null;
  }
}

/** Companies House search by name: the raw `items` array (cleaned later by parseCompanySearchItems), or null on error. */
export async function searchCompaniesByName(name: string, apiKey: string): Promise<unknown[] | null> {
  try {
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(name.slice(0, 120))}&items_per_page=20`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const data = await res.json() as { items?: unknown };
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return null;
  }
}

/** A company's profile (name, status, registered office): only type-checked fields, or null on error / not found. */
export async function fetchCompanyProfile(companyNumber: string, apiKey: string): Promise<{ name: string; status: string | null; postcode: string | null; locality: string | null; address: string | null } | null> {
  try {
    const res = await fetchWithTimeout(`https://api.company-information.service.gov.uk/company/${encodeURIComponent(companyNumber)}`, {
      headers: { Authorization: 'Basic ' + btoa(`${apiKey}:`) },
    });
    if (!res.ok) return null;
    const d = await res.json() as Record<string, unknown> | null;
    const name = typeof d?.company_name === 'string' ? d.company_name.slice(0, 160) : null;
    if (!name) return null;
    const a = (typeof d?.registered_office_address === 'object' && d.registered_office_address !== null ? d.registered_office_address : {}) as Record<string, unknown>;
    const s = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    const address = [a.address_line_1, a.address_line_2, a.locality, a.postal_code].map((v) => s(v, 80)).filter(Boolean).join(', ') || null;
    return { name, status: s(d?.company_status, 40), postcode: s(a.postal_code, 12), locality: s(a.locality, 60), address };
  } catch {
    return null;
  }
}
