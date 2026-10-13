// supabase/functions/_shared/deepFindRegistry.ts
// Settles a lead's registered company for Deep find: the number saved on the lead (leads.company_number, migration
// 058), the scraped raw lead it came from, or a Companies House search by NAME that only auto-picks a clear match
// (registrySearch.ts) and otherwise offers the top 3 candidates for the user to choose. Service client only; the
// caller has already checked the org and the run creator's rights on the lead.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { fetchCompanyProfile, searchCompaniesByName } from './companiesHouse.ts';
import { cleanCompanyNumber, pickCompany, scoreCompanyCandidates, type CompanyCandidate } from './registrySearch.ts';
import { registrySearchNames } from './nameVariants.ts';

/** The registered company as far as it is known, and how it was settled. */
export interface RegistryResult {
  number: string | null;
  name: string | null;
  address: string | null;
  locality: string | null;
  how: 'saved' | 'raw_lead' | 'auto' | 'ambiguous' | 'not_found' | 'no_key' | 'error';
  /** Candidates to choose from when the name search was not clear (top 3). */
  candidates: CompanyCandidate[];
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Fixed sentence for the run's step list. Only counts and the cleaned company name/number are interpolated. */
export function registryStep(r: RegistryResult): string {
  const name = (r.name ?? '').replace(/[^\p{L}\p{N} &'.,()-]/gu, '').slice(0, 120);
  switch (r.how) {
    case 'saved': return `Companies House: using the company saved on this lead (${name || r.number}).`;
    case 'raw_lead': return `Companies House: using the company this lead was found from (${name || r.number}).`;
    case 'auto': return `Companies House: matched ${name} (${r.number}).`;
    case 'ambiguous': return `Companies House: ${r.candidates.length} possible companies, please choose.`;
    case 'not_found': return 'Companies House: no company with this name was found.';
    case 'no_key': return 'Companies House: no key is set for this organisation, so it was skipped.';
    default: return 'Companies House: the search did not work this time.';
  }
}

/**
 * Resolves the lead's registered company. A clear automatic match is saved on the lead (company_number) so later
 * runs reuse it; an unclear one is never guessed.
 */
export async function resolveRegistry(service: SupabaseClient, lead: Record<string, unknown> & { id: string }, chKey: string | null): Promise<RegistryResult> {
  const empty = { address: null, locality: null, candidates: [] as CompanyCandidate[] };
  const saved = cleanCompanyNumber(lead.company_number);
  if (saved) {
    const profile = chKey ? await fetchCompanyProfile(saved, chKey) : null;
    return { ...empty, number: saved, name: profile?.name ?? null, address: profile?.address ?? null, locality: profile?.locality ?? null, how: 'saved' };
  }
  const rawId = str(lead.raw_lead_id);
  if (rawId) {
    const { data } = await service.from('raw_leads').select('source, source_id, raw_data').eq('id', rawId).maybeSingle();
    const raw = data as { source?: unknown; source_id?: unknown; raw_data?: unknown } | null;
    const number = raw?.source === 'companies_house' ? cleanCompanyNumber(raw.source_id) : null;
    if (number) {
      const company = (raw?.raw_data as { company?: { title?: unknown; address_snippet?: unknown } } | null)?.company;
      return { ...empty, number, name: str(company?.title)?.slice(0, 160) ?? null, address: str(company?.address_snippet)?.slice(0, 200) ?? null, how: 'raw_lead' };
    }
  }
  const name = str(lead.business_name);
  if (!name) return { ...empty, number: null, name: null, how: 'not_found' };
  if (!chKey) return { ...empty, number: null, name: null, how: 'no_key' };
  // Search several name variants and merge the results by company number (LOVELIVING LIMITED is found by 'loveliving').
  const items: unknown[] = [];
  const seen = new Set<string>();
  let anyOk = false;
  for (const variant of registrySearchNames(name)) {
    const found = await searchCompaniesByName(variant, chKey);
    if (found === null) continue;
    anyOk = true;
    for (const it of found) {
      const n = cleanCompanyNumber((it as { company_number?: unknown } | null)?.company_number);
      if (n && !seen.has(n)) { seen.add(n); items.push(it); }
    }
  }
  if (!anyOk) return { ...empty, number: null, name: null, how: 'error' };
  const loc = { postcode: str(lead.postcode), city: str(lead.city), address: str(lead.address) };
  const pick = pickCompany(scoreCompanyCandidates(items, name, loc), name, loc);
  if (pick.chosen) {
    const { error } = await service.from('leads').update({ company_number: pick.chosen.company_number })
      .eq('id', lead.id).is('company_number', null);
    if (error) console.error('deep find: could not save the company number');
    return {
      number: pick.chosen.company_number, name: pick.chosen.name, address: pick.chosen.address, locality: pick.chosen.locality,
      how: 'auto', candidates: [],
    };
  }
  return { ...empty, number: null, name: null, how: pick.candidates.length ? 'ambiguous' : 'not_found', candidates: pick.candidates };
}
