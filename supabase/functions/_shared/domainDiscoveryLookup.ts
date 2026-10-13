// supabase/functions/_shared/domainDiscoveryLookup.ts
// Wires domain discovery to the real providers and saves what it finds on leads.email_domains (service client only).
// Keys are only sent to the providers in headers: never logged, returned, or put in an error.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { domainFromWebsite } from './knownPerson.ts';
import {
  apolloOrgSearch, hunterCompanySearch, hunterDomainList, hunterFindByCompany, readCompanyPages, webSearchCompanyDomains,
} from './knownPersonLookup.ts';
import { companyNameVariants } from './nameVariants.ts';
import { lookupMx } from './dnsLookup.ts';
import { runDomainDiscovery, type DiscoveryOutcome, type DomainCandidate, type KnownPersonName } from './domainDiscovery.ts';
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';

export { DOMAIN_CHECKS, savedDomains };

/** At most this many domains are kept on leads.email_domains. */
export const MAX_SAVED_DOMAINS = 6;

/** The lead fields discovery reads. */
export interface DiscoveryLead {
  id: string; org_id: string; business_name?: string | null; website: string | null; email?: string | null;
  city?: string | null; postcode?: string | null; email_domains?: unknown; blocked_domains?: unknown;
}

/**
 * Runs discovery for one lead and saves newly found domains (never web-only ones) on leads.email_domains, after the
 * ones already saved, without the website's own domain, at most MAX_SAVED_DOMAINS. `extraKnown` are domains the
 * caller already searches (a typed domain, contacts' email domains). The caller must have checked org membership.
 */
export async function discoverLeadDomains(
  service: SupabaseClient,
  lead: DiscoveryLead,
  opts: {
    registeredName?: string | null;
    /** The Companies House registered office, for the web search. */
    registeredAddress?: string | null;
    /** People known to work there, for "confirmed by a person". */
    people?: KnownPersonName[];
    /** True when the lead's website may belong to another company: it only counts as a weak signal and is not read. */
    websiteSuspect?: boolean;
    extraKnown?: DomainCandidate[];
    keys: { hunterKey: string | null; geminiKey: string | null; apolloKey?: string | null };
    allow: { hunter: boolean; site: boolean; web: boolean; apollo?: boolean };
    /** At most this many Hunter requests in discovery (default 12). */
    hunterCap?: number;
    budgetMs: number;
    /** Website pages the caller already read (readCompanyPages), so the site is not fetched twice. */
    pages?: string[];
    /** Spends one credit before each paid call; false means the cap is reached and the call is not made. */
    guard?: { hunter: () => Promise<boolean>; ai: () => Promise<boolean> };
  },
): Promise<DiscoveryOutcome & { saved: string[] }> {
  const websiteDomain = (() => {
    const d = domainFromWebsite(lead.website);
    return d && DOMAIN_CHECKS.usable(d) ? d : null;
  })();
  const already = savedDomains(lead.email_domains);
  const known: DomainCandidate[] = [
    ...(opts.extraKnown ?? []).filter((k) => k.source === 'typed'),
    ...(websiteDomain ? [{ domain: websiteDomain, source: opts.websiteSuspect ? 'website_suspect' as const : 'website' as const }] : []),
    ...already.map((domain) => ({ domain, source: 'saved' as const })),
    ...(opts.extraKnown ?? []).filter((k) => k.source !== 'typed'),
  ];
  const names = [lead.business_name ?? '', opts.registeredName ?? ''].filter((n) => n.trim() !== '');
  const { hunterKey, geminiKey } = opts.keys;
  const apolloKey = opts.keys.apolloKey ?? null;
  // Spellings to SEARCH with; every domain found is still judged against the real names.
  const variants = companyNameVariants(names).map((v) => v.text);
  const blocked = savedDomains(lead.blocked_domains);
  const spendHunter = async () => !opts.guard || await opts.guard.hunter();
  const outcome = await runDomainDiscovery({
    names, variants, hunterCap: opts.hunterCap, registeredName: opts.registeredName ?? null, people: opts.people ?? [], websiteSuspect: !!opts.websiteSuspect, blocked,
    website: websiteDomain ? lead.website : null, websiteDomain, known,
    allow: { hunter: opts.allow.hunter && !!hunterKey, site: opts.allow.site && !!websiteDomain, web: opts.allow.web && !!geminiKey, apollo: !!opts.allow.apollo && !!apolloKey },
    budgetMs: opts.budgetMs,
  }, {
    now: () => Date.now(),
    hunterByName: async (name, t) => (await spendHunter()
      ? hunterCompanySearch(name, hunterKey ?? '', t) : { ok: false as const, failure: 'cap_reached' }),
    readSite: (w, t) => (opts.pages ? Promise.resolve(opts.pages) : readCompanyPages(w, t)),
    webSearch: async (t) => (opts.guard && !(await opts.guard.ai())) ? { ok: false as const, failure: 'cap_reached' } : webSearchCompanyDomains({
      names, town: lead.city ?? null, postcode: lead.postcode ?? null, website: lead.website,
      registeredAddress: opts.registeredAddress ?? null, websiteSuspect: !!opts.websiteSuspect, variants,
      knownDomains: known.filter((k) => k.source !== 'website_suspect' && !blocked.includes(k.domain)).map((k) => k.domain),
    }, geminiKey ?? '', t),
    apolloOrg: (n, t) => apolloOrgSearch(n, apolloKey ?? '', t),
    // Free: the discovered domain's own pages, through the SSRF-guarded page reader (home + up to 5 team pages).
    readDomainSite: (d, t) => readCompanyPages(`https://${d}`, t, 5),
    mx: (d, t) => lookupMx(d, t),
    // Each Hunter call reserves a credit first (limit 10 = at most about one credit); a refusal stops the probing.
    hunterList: async (d, t) => {
      if (!await spendHunter()) return { ok: false as const, failure: 'cap_reached' };
      const res = await hunterDomainList(d, hunterKey ?? '', t, 10);
      return res.ok ? { ok: true as const, organization: res.organization ?? null, emails: res.emails } : res;
    },
    hunterFindByCompany: async (company, first, last, t) => (await spendHunter()
      ? hunterFindByCompany(company, first, last, hunterKey ?? '', t) : { ok: false as const, failure: 'cap_reached' }),
  }, DOMAIN_CHECKS);

  const fresh = outcome.discovered.filter((d) => !d.needs_check && d.domain !== websiteDomain && !blocked.includes(d.domain)).map((d) => d.domain);
  const toAdd = fresh.filter((d) => !already.includes(d)).slice(0, Math.max(0, MAX_SAVED_DOMAINS - already.length));
  let saved = already;
  if (toAdd.length > 0) {
    // Atomic append (migration 056 RPC): dedupes and caps in one locked statement, so two lookups never drop each other's.
    const { data, error } = await service.rpc('lead_add_email_domains', { target_lead: lead.id, new_domains: toAdd });
    if (error) console.error('Could not save discovered domains');
    else saved = savedDomains(data);
  }
  return { ...outcome, saved };
}
