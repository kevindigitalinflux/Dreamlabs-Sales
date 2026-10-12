// supabase/functions/_shared/domainDiscoveryLookup.ts
// Wires domain discovery to the real providers and saves what it finds on leads.email_domains (service client only).
// Keys are only sent to the providers in headers: never logged, returned, or put in an error.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { domainFromWebsite } from './knownPerson.ts';
import { hunterCompanySearch, readCompanyPages, webSearchCompanyDomains } from './knownPersonLookup.ts';
import { runDomainDiscovery, type DiscoveryOutcome, type DomainCandidate } from './domainDiscovery.ts';
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';

export { DOMAIN_CHECKS, savedDomains };

/** At most this many domains are kept on leads.email_domains. */
export const MAX_SAVED_DOMAINS = 6;

/** The lead fields discovery reads. */
export interface DiscoveryLead {
  id: string; org_id: string; business_name?: string | null; website: string | null; email?: string | null;
  city?: string | null; postcode?: string | null; email_domains?: unknown;
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
    extraKnown?: DomainCandidate[];
    keys: { hunterKey: string | null; geminiKey: string | null };
    allow: { hunter: boolean; site: boolean; web: boolean };
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
    ...(websiteDomain ? [{ domain: websiteDomain, source: 'website' as const }] : []),
    ...already.map((domain) => ({ domain, source: 'saved' as const })),
    ...(opts.extraKnown ?? []).filter((k) => k.source !== 'typed'),
  ];
  const names = [lead.business_name ?? '', opts.registeredName ?? ''].filter((n) => n.trim() !== '');
  const { hunterKey, geminiKey } = opts.keys;
  const outcome = await runDomainDiscovery({
    names, website: websiteDomain ? lead.website : null, websiteDomain, known,
    allow: { hunter: opts.allow.hunter && !!hunterKey, site: opts.allow.site && !!websiteDomain, web: opts.allow.web && !!geminiKey },
    budgetMs: opts.budgetMs,
  }, {
    now: () => Date.now(),
    hunterByName: async (name, t) => (!opts.guard || await opts.guard.hunter()
      ? hunterCompanySearch(name, hunterKey ?? '', t) : { ok: false as const, failure: 'cap_reached' }),
    readSite: (w, t) => (opts.pages ? Promise.resolve(opts.pages) : readCompanyPages(w, t)),
    webSearch: async (t) => (opts.guard && !(await opts.guard.ai())) ? { ok: false as const, failure: 'cap_reached' } : webSearchCompanyDomains({ names, town: lead.city ?? null, postcode: lead.postcode ?? null, website: lead.website }, geminiKey ?? '', t),
  }, DOMAIN_CHECKS);

  const fresh = outcome.discovered.filter((d) => !d.needs_check && d.domain !== websiteDomain).map((d) => d.domain);
  const next = [...already, ...fresh.filter((d) => !already.includes(d))].slice(0, MAX_SAVED_DOMAINS);
  if (next.length !== already.length) {
    const { error } = await service.from('leads').update({ email_domains: next }).eq('id', lead.id).eq('org_id', lead.org_id);
    if (error) console.error('Could not save discovered domains');
  }
  return { ...outcome, saved: next };
}
