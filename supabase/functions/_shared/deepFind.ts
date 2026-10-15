// supabase/functions/_shared/deepFind.ts
// Deep find engine: claims queued leads, discovers the company's domains and people, stores people as contacts that are
// NOT in sequences, and writes a plain-English summary per lead. Never emails anyone and never touches sequences.
// Runs with the service client, so every org boundary is re-checked here. Keys only go to providers in headers.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from './orgApiKeys.ts';
import { checkRateLimit } from './rateLimit.ts';
import { fetchActiveOfficers } from './companiesHouse.ts';
import { registryStep, resolveRegistry } from './deepFindRegistry.ts';
import { lookUpPeople } from './deepFindPeople.ts';
import { discoverLeadDomains } from './domainDiscoveryLookup.ts';
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';
import { hunterAccount, hunterDomainList, hunterVerifyEmail, readCompanyPages } from './knownPersonLookup.ts';
import { guessLabel, inferDomainPattern, patternGuess, patternLine, type PatternSample } from './domainPattern.ts';
import { hunterAccountEmpty, hunterAccountLine, type HunterAccount } from './hunterLimits.ts';
import { cleanEmail, cleanLinkedinProfile, emailDomain, extractWebsiteFindings, pickWebsiteFindings } from './knownPersonWide.ts';
import { domainEmailsOnPages } from './domainSiteCheck.ts';
import { extractPhone } from './websiteContact.ts';
import { domainFromWebsite, isDirectoryDomain } from './knownPerson.ts';
import { rankPeople } from './peopleRanking.ts';
import { DOMAIN_SOURCE_LABELS, safeFailure, websiteSuspicion, type KnownPersonName, type WebPerson } from './domainDiscovery.ts';
import { creditLine, problemLines, type ProblemInput } from './deepFindProblems.ts';
import {
  MAX_HUNTER_PEOPLE_PER_LEAD, deepFindSummary, emailOnLead, extractTeamMembers, findSamePerson,
  hunterPeople, namedPersonIsStored, parseLeadPersonName, peopleToLookUp, stuckAction, type ExistingContact, type LeadStats, type SitePerson,
} from './deepFindRules.ts';
import { makeWorkerClient } from './workerClient.ts';
import { scrapeTimeoutFor, unconfirmedLabel, verifyAction } from './workerRules.ts';

export const WALL_BUDGET_MS = 130_000;
/** A lead is only started when at least this much of the invocation is left. */
const LEAD_RESERVE_MS = 80_000;
const LEAD_BUDGET_MS = 70_000;
const nowIso = () => new Date().toISOString();

/** The run columns the engine reads. */
export interface DeepFindRun { id: string; org_id: string; created_by: string; status: string }
interface ClaimedRow { id: string; run_id: string; org_id: string; lead_id: string; attempts: number }
type Contact = ExistingContact & Record<string, unknown>;
interface LeadOutcome { status: 'done' | 'failed' | 'skipped'; reason: string; people_found?: number; domains?: Record<string, unknown> }

/**
 * Spends run credits through the atomic deep_find_reserve RPC (the no-overspend guard). One Hunter unit per Hunter
 * request (company search and lists limited to 10 addresses, finder, verifier), so hunter_used approximates real
 * Hunter credits; one AI unit per Gemini call.
 */
class Spend {
  hunterHit = false;
  aiHit = false;
  /** Credits actually reserved, per step, for the results view. */
  used: { hunter: Record<string, number>; ai: Record<string, number> } = { hunter: {}, ai: {} };
  constructor(private service: SupabaseClient, private runId: string) {}
  private async reserve(hunter: number, ai: number): Promise<boolean> {
    const { data, error } = await this.service.rpc('deep_find_reserve', { run_id: this.runId, hunter, ai });
    return !error && data === true;
  }
  /** Set when Hunter's searches are used up or it asked us to slow down: no more Hunter calls for this lead. */
  hunterStopped = false;
  stopHunter(): void { this.hunterStopped = true; }
  async hunter(step = 'other'): Promise<boolean> {
    if (this.hunterHit || this.hunterStopped) return false;
    const ok = await this.reserve(1, 0);
    if (!ok) this.hunterHit = true;
    else this.used.hunter[step] = (this.used.hunter[step] ?? 0) + 1;
    return ok;
  }
  async ai(step = 'other'): Promise<boolean> {
    if (this.aiHit) return false;
    const ok = await this.reserve(0, 1);
    if (!ok) this.aiHit = true;
    else this.used.ai[step] = (this.used.ai[step] ?? 0) + 1;
    return ok;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** Inserts provider rows with ON CONFLICT DO NOTHING on (lead_id, dedupe_key); returns the rows actually inserted. */
async function insertContacts(service: SupabaseClient, rows: Record<string, unknown>[]): Promise<Contact[]> {
  if (rows.length === 0) return [];
  const { data, error } = await service.from('decision_maker_candidates')
    .upsert(rows, { onConflict: 'lead_id,dedupe_key', ignoreDuplicates: true }).select('*');
  if (error) { console.error('deep find: contact insert failed'); return []; }
  return (data ?? []) as Contact[];
}

/**
 * Fills blank fields of an existing contact (service client), never overwriting. An email found this way switches the
 * contact's follow-ups off (the address may belong to someone else until the user checks it). Returns the saved row.
 */
async function fillBlanks(service: SupabaseClient, row: Contact, patch: Record<string, string>): Promise<Contact | null> {
  const cols: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (!str(row[k])) cols[k] = v;
  if (Object.keys(cols).length === 0) return null;
  if (cols.email && row.include_in_sequences === true) cols.include_in_sequences = false;
  let q = service.from('decision_maker_candidates').update({ ...cols, updated_at: nowIso() }).eq('id', row.id);
  if (cols.email) q = q.is('email', null);
  const { data, error } = await q.select('*');
  if (error || !data || data.length === 0) return null;
  return data[0] as Contact;
}

/** One lead, start to finish. Returns the outcome to store; never throws for provider problems. */
export async function processDeepFindLead(service: SupabaseClient, run: DeepFindRun, row: ClaimedRow): Promise<LeadOutcome> {
  const deadline = Date.now() + LEAD_BUDGET_MS;
  const left = () => deadline - Date.now();
  const { data: leadData, error: leadErr } = await service.from('leads').select('*').eq('id', row.lead_id).maybeSingle();
  if (leadErr) return { status: 'failed', reason: 'Could not load this lead.' };
  const lead = leadData as (Record<string, unknown> & { id: string; org_id: string }) | null;
  if (!lead) return { status: 'skipped', reason: 'The lead no longer exists.' };
  if (lead.org_id !== run.org_id || row.org_id !== run.org_id) return { status: 'skipped', reason: 'The lead is not in this organisation.' };
  // Re-check, as the run's creator, the same edit rights can_edit_lead gives (they may have changed since create).
  const { data: canEdit, error: canEditErr } = await service.rpc('deep_find_creator_can_edit', { target_user: run.created_by, target_lead: lead.id });
  if (canEditErr) return { status: 'failed', reason: 'Could not check access to this lead.' };
  if (canEdit !== true) return { status: 'skipped', reason: 'The person who started this Deep find can no longer edit this lead.' };
  if (!await checkRateLimit(service, `deep-find:${run.org_id}:${lead.id}`, 5, 24 * 60, true)) {
    return { status: 'skipped', reason: 'Deep find already ran 5 times on this lead today. Try again tomorrow.' };
  }
  if (!await checkRateLimit(service, `deep-find:${run.org_id}`, 200, 24 * 60, true)) {
    return { status: 'skipped', reason: 'This organisation reached its daily Deep find limit. Try again tomorrow.' };
  }

  const [hunterKey, geminiKey, chKey, apolloKey] = await Promise.all([
    resolveOrgApiKey(service, run.org_id, 'hunter'),
    resolveOrgApiKey(service, run.org_id, 'gemini'),
    resolveOrgApiKey(service, run.org_id, 'companies_house'),
    resolveOrgApiKey(service, run.org_id, 'apollo'),
  ]);
  const spend = new Spend(service, run.id);
  // Organisation's worker, or the shared worker only with explicit fallback permission.
  const worker = makeWorkerClient({
    usage: service, orgId: run.org_id,
    config: await resolveOrgWorkerConfig(service, run.org_id),
  });
  const { data: contactData, error: contactErr } = await service.from('decision_maker_candidates').select('*').eq('lead_id', lead.id);
  if (contactErr) return { status: 'failed', reason: 'Could not read this lead\'s contacts.' };
  const rows = (contactData ?? []) as Contact[];
  const created: Contact[] = [];
  const stats: LeadStats = {
    hunterPeople: 0, officersAdded: 0, officerEmails: 0, domainsShown: [], domainsToCheck: 0, namedByWeb: 0, namedOnSite: 0,
    hunterCapHit: false, aiCapHit: false, noHunterKey: !hunterKey, noWebsite: false, unverifiedPeople: 0,
  };
  /** Steps that gave no answer, turned into one plain line each at the end. */
  const problems: ProblemInput[] = [];
  /** Contacts this run created or filled, the only ones whose LinkedIn link is captured. */
  const touched = new Set<string>();
  const suggestions: { name: string; field: string; value: string; label: string }[] = [];
  /** Plain-English step lines shown with the results. */
  const steps: string[] = [];
  const all = () => [...rows, ...created];

  // Hunter's free account check (no search credits): how many searches are left, and stop early when none are.
  let hunterAccountInfo: HunterAccount | null = null;
  if (hunterKey) {
    const acc = await hunterAccount(hunterKey, 5_000);
    if (acc.ok) {
      hunterAccountInfo = acc.account;
      const line = hunterAccountLine(acc.account);
      if (line) steps.push(line);
      if (hunterAccountEmpty(acc.account)) { spend.stopHunter(); problems.push({ step: 'hunter_company', target: 'account', failure: 'usage_exhausted' }); }
    } else if (acc.failure === 'usage_exhausted' || acc.failure === 'rate_limited') {
      spend.stopHunter();
      problems.push({ step: 'hunter_company', target: 'account', failure: acc.failure });
    }
  }

  // (0) the registered company and its officers (officers become companies_house contacts, as before)
  // People we already know (owner names on the lead, contacts): used to find the company through Companies House officers.
  const registryPeople = [
    ...[lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners.slice(0, 10) : [])]
      .flatMap((n) => { const p = parseLeadPersonName(n); return p ? [{ first: p.first, last: p.last }] : []; }),
    ...rows.flatMap((c) => (str(c.first_name) && str(c.last_name) && !c.dismissed_at ? [{ first: str(c.first_name)!, last: str(c.last_name)! }] : [])),
  ].slice(0, 6);
  const registry = await resolveRegistry(service, lead, chKey, registryPeople);
  steps.push(registryStep(registry));
  const officers = registry.number && chKey ? await fetchActiveOfficers(registry.number, chKey) : [];
  const officerRows: Record<string, unknown>[] = [];
  for (const o of officers) {
    if (!o.first_name || !o.last_name || findSamePerson(all(), o.first_name, o.last_name)) continue;
    if (officerRows.some((r) => r.first_name === o.first_name && r.last_name === o.last_name)) continue;
    officerRows.push({ lead_id: lead.id, source: 'companies_house', first_name: o.first_name, last_name: o.last_name, title: o.title, created_by: run.created_by });
  }
  if (officerRows.length > 0) {
    const { data, error } = await service.from('decision_maker_candidates').insert(officerRows).select('*');
    if (error) problems.push({ step: 'save', target: 'the Companies House officers', failure: 'network' });
    else { created.push(...((data ?? []) as Contact[])); stats.officersAdded = (data ?? []).length; }
  }
  if (registry.number) steps.push(`Companies House officers: ${officers.length} active, ${stats.officersAdded} added as contacts.`);

  // the website pages, read once
  const siteDomain = domainFromWebsite(str(lead.website));
  // A website domain the user marked "Not their domain" is never read or searched.
  const siteBlocked = !!siteDomain && savedDomains(lead.blocked_domains).includes(siteDomain);
  if (siteBlocked) steps.push('The lead\'s website domain was marked as not theirs, so the website was not used.');
  const siteReadable = !!siteDomain && !siteBlocked && DOMAIN_CHECKS.usable(siteDomain);
  const sitePages = siteReadable && left() > 30_000 ? await readCompanyPages(str(lead.website)!, 12_000) : [];
  // A website that shows clear signs of another company is only a weak signal: not read for people or other domains.
  const suspicion = websiteSuspicion(sitePages, [str(lead.business_name) ?? '', registry.name ?? ''].filter(Boolean));
  if (suspicion.suspect) steps.push(`This website may belong to a different company: ${suspicion.reasons.join(' ')}`);
  const usableSite = siteReadable && !suspicion.suspect;
  stats.noWebsite = !usableSite;
  const pages = usableSite ? sitePages : [];
  // Everyone known to work there (contacts, officers, names on the lead): a domain where Hunter lists one of them is confirmed.
  const knownPeople: KnownPersonName[] = [
    ...all().flatMap((c) => (str(c.first_name) && str(c.last_name) ? [{ first: str(c.first_name)!, last: str(c.last_name)! }] : [])),
    ...officers.flatMap((o) => (o.first_name && o.last_name ? [{ first: o.first_name, last: o.last_name }] : [])),
    ...[lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners.slice(0, 10) : [])]
      .flatMap((n) => { const p = parseLeadPersonName(n); return p ? [{ first: p.first, last: p.last }] : []; }),
  ].slice(0, 20);

  // (1) the company's domains
  const contactDomains = rows.map((r) => emailDomain(str(r.email))).filter((d): d is string => !!d);
  const discovery = await discoverLeadDomains(service, {
    id: lead.id, org_id: lead.org_id, business_name: str(lead.business_name), website: str(lead.website), email: str(lead.email),
    city: str(lead.city), postcode: str(lead.postcode), email_domains: lead.email_domains, blocked_domains: lead.blocked_domains,
  }, {
    registeredName: registry.name, registeredAddress: registry.address, people: knownPeople, websiteSuspect: suspicion.suspect,
    extraKnown: contactDomains.map((domain) => ({ domain, source: 'contact_email' as const })),
    keys: { hunterKey, geminiKey, apolloKey }, allow: { hunter: true, site: pages.length > 0, web: true, apollo: true },
    budgetMs: Math.min(30_000, Math.max(0, left() - 30_000)), pages, hunterCap: 12,
    guard: { hunter: () => spend.hunter('company domains'), ai: () => spend.ai('web search') },
  });
  problems.push(...discovery.problems);
  if (discovery.problems.some((p) => p.step.startsWith('hunter') && (p.failure === 'usage_exhausted' || p.failure === 'rate_limited'))) spend.stopHunter();
  const domains = discovery.domains.map((d) => d.domain);
  // People are only stored from corroborated domains (Review Focus 2); the rest give suggestions only.
  const verified = new Set(discovery.domains.filter((d) => !d.needs_check).map((d) => d.domain));
  stats.domainsShown = discovery.domains.filter((d) => !d.needs_check && d.domain !== siteDomain).map((d) => d.domain);
  stats.domainsToCheck = discovery.domains.filter((d) => d.needs_check).length;
  const webPeople: WebPerson[] = discovery.people;
  steps.push(...discovery.notes.slice(0, 6));
  for (const d of discovery.domains.slice(0, 6)) {
    const how = d.sources.map((x) => DOMAIN_SOURCE_LABELS[x]).join(', ');
    steps.push(d.needs_check ? `Domain ${d.domain}: not confirmed (${how}), used for searching only.` : `Domain ${d.domain}: confirmed (${how}).`);
  }

  // (1b) free team scan on discovered domains whose OWN website confirmed them: emails written literally on the
  // site for the people we know (filled for existing contacts, suggestions otherwise) and named staff to check.
  const confirmedSites = discovery.sitePages.filter((s) => verified.has(s.domain));
  const siteEmails = new Map<string, string[]>();
  const extraSitePeople: SitePerson[] = [];
  for (const s of confirmedSites) {
    siteEmails.set(s.domain, domainEmailsOnPages(s.pages, s.domain));
    for (const html of s.pages) extraSitePeople.push(...extractTeamMembers(html));
  }
  // (1b-scrape) A confirmed domain whose pages gave no address (a site that needs a browser, or one we could not read):
  // one browser scrape per lead. Only addresses on that domain are kept; they are suggestions with their source page
  // and also feed the email-format step below. Skipped when the worker is off, over its limit, or there is not enough time left for a 25 s scrape.
  // Phones are not pushed as suggestions: the suggestion UI only applies email and LinkedIn.
  // The lead's own website pages were read above (not part of discovery.sitePages): count what they already show,
  // so a site that gave an address or a phone number is not scraped again.
  if (siteDomain && verified.has(siteDomain) && pages.length > 0) {
    siteEmails.set(siteDomain, [...new Set([...(siteEmails.get(siteDomain) ?? []), ...domainEmailsOnPages(pages, siteDomain)])]);
  }
  const hasContactDetails = (d: string) =>
    (siteEmails.get(d) ?? []).length > 0 || (d === siteDomain && pages.some((html) => !!extractPhone(html)));
  const scrapeDomain = [...verified].find((d) => !hasContactDetails(d) && !isDirectoryDomain(d));
  const scrapeTimeout = scrapeTimeoutFor(left());
  if (scrapeDomain && scrapeTimeout !== null) {
    const scraped = await worker.scrapeSite(scrapeDomain, 'key_pages', { timeoutMs: scrapeTimeout });
    if (scraped.ok) {
      const pageOf = (source: string | null) => { try { return source ? ` (${new URL(source).pathname.slice(0, 80)})` : ''; } catch { return ''; } };
      for (const e of scraped.value.emails) {
        if (emailOnLead(all(), e.value) || suggestions.some((s) => s.value === e.value)) continue;
        suggestions.push({ name: 'Company contact', field: 'email', value: e.value, label: `Found by the browser scraper on ${scrapeDomain}${pageOf(e.source)}, check it` });
      }
      siteEmails.set(scrapeDomain, [...(siteEmails.get(scrapeDomain) ?? []), ...scraped.value.emails.map((e) => e.value)]);
    }
  }
  for (const person of confirmedSites.length > 0 ? peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers) : []) {
    for (const s of confirmedSites) {
      const picked = pickWebsiteFindings(s.pages.map((h) => extractWebsiteFindings(h, s.domain, person.first, person.last)), person.first, person.last);
      const email = picked.email ? cleanEmail(picked.email) : null;
      if (!email || emailOnLead(all(), email)) continue;
      const contact = person.contactId ? all().find((c) => c.id === person.contactId) ?? null : null;
      if (contact) {
        const saved = await fillBlanks(service, contact, { email });
        if (saved) { Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++; }
      } else {
        suggestions.push({ name: `${person.first} ${person.last}`.slice(0, 80), field: 'email', value: email, label: `Found on ${s.domain}, check it` });
      }
      break;
    }
  }

  // (1c) the email format on each confirmed domain, from addresses we already know there (contacts, the lead's own
  // email, addresses written on the domain's site). Built addresses are checked with our own checker first, then Hunter when it cannot decide and credits allow;
  // otherwise they are only offered as "Guess, unverified" suggestions: never filled in, never in sequences.
  const knownNames = [
    ...peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers).map((p) => ({ first: p.first, last: p.last })),
    ...extraSitePeople.flatMap((p) => { const n = parseLeadPersonName(p.name); return n ? [{ first: n.first, last: n.last }] : []; }),
  ].slice(0, 20);
  const ownerName = parseLeadPersonName(lead.owner_name);
  let verifications = 0;
  for (const d of [...verified].slice(0, 4)) {
    const samples: PatternSample[] = [
      ...all().flatMap((c) => (str(c.email) && emailDomain(str(c.email)) === d ? [{ email: str(c.email)!, first: str(c.first_name), last: str(c.last_name) }] : [])),
      ...(str(lead.email) && emailDomain(str(lead.email)) === d ? [{ email: str(lead.email)!, first: ownerName?.first ?? null, last: ownerName?.last ?? null }] : []),
      ...(siteEmails.get(d) ?? []).map((email) => ({ email, first: null, last: null })),
    ];
    const pattern = inferDomainPattern(d, samples, knownNames);
    if (!pattern) continue;
    steps.push(patternLine(d, pattern));
    for (const person of peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers).slice(0, 5)) {
      const guess = patternGuess(pattern, person, d);
      if (!guess || emailOnLead(all(), guess) || suggestions.some((s) => s.value === guess)) continue;
      const name = `${person.first} ${person.last}`.slice(0, 80);
      let verdict: string | null = null;
      let label = guessLabel(pattern, d);
      // Free checker first; Hunter is asked only when it cannot decide and credits remain.
      const checked = left() > 25_000 ? await worker.verifyEmail(guess) : null;
      const action = verifyAction(checked && checked.ok ? checked.value.status : null, !!hunterKey && verifications < 3 && left() > 25_000);
      if (action === 'drop') continue;
      if (action === 'accept') {
        verdict = 'verified';
        label = 'Built from the email format and confirmed by our email checker, check it';
      } else if (action === 'ask_hunter' && await spend.hunter('verify email format')) {
        verifications++;
        const v = await hunterVerifyEmail(guess, hunterKey!, 5_000);
        if (v.ok) {
          verdict = v.verdict;
          if (verdict === 'verified') label = 'Built from the email format and verified by Hunter, check it';
        } else {
          problems.push({ step: 'hunter_verify', target: d, failure: safeFailure(v.failure) });
          if (v.failure === 'usage_exhausted' || v.failure === 'rate_limited') spend.stopHunter();
        }
      }
      if (verdict === 'invalid') continue;
      if (verdict !== 'verified' && checked && checked.ok) label = unconfirmedLabel(checked.value.reason);
      const contact = person.contactId ? all().find((c) => c.id === person.contactId) ?? null : null;
      // When our checker answered (risky/unverifiable) Hunter's "verified" only makes this a labelled suggestion, never a fill.
      const checkerDecided = !!(checked && checked.ok);
      const checkerSaidValid = action === 'accept';
      if (verdict === 'verified' && contact && (checkerSaidValid || !checkerDecided)) {
        const saved = await fillBlanks(service, contact, { email: guess });
        if (saved) { Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++; }
      } else {
        suggestions.push({ name, field: 'email', value: guess, label });
      }
    }
  }

  // (2) Hunter's company list on every domain: every named person with a role
  const lists = new Map<string, { emails: unknown[]; pattern: string | null }>();
  for (const d of domains) {
    if (!hunterKey || left() < 20_000) break;
    if (!await spend.hunter('company lists')) break;
    // limit 10: Hunter bills about 1 credit per 10 addresses, so one reserved credit covers this call.
    const res = await hunterDomainList(d, hunterKey, 6_000, 10);
    if (res.ok) lists.set(d, { emails: res.emails, pattern: res.pattern });
    else {
      problems.push({ step: 'hunter_list', target: d, failure: safeFailure(res.failure) });
      if (res.failure === 'usage_exhausted' || res.failure === 'rate_limited') { spend.stopHunter(); break; }
    }
  }
  const listed = [...lists.entries()].flatMap(([d, l]) => hunterPeople(l.emails, d, cleanEmail, cleanLinkedinProfile).map((p) => ({ ...p, domain: d })));
  const found = rankPeople(listed.filter((p) => verified.has(p.domain)), webPeople).slice(0, MAX_HUNTER_PEOPLE_PER_LEAD);
  // People on a domain that is not corroborated are never stored: they are listed for the user to check.
  const unverifiedPeople = rankPeople(listed.filter((p) => !verified.has(p.domain)), webPeople)
    .filter((p) => !emailOnLead(rows, p.email)).slice(0, 10)
    .map((p) => ({ name: `${p.first_name} ${p.last_name}`.slice(0, 80), role: p.title.slice(0, 60), email: p.email, domain: p.domain }));
  stats.unverifiedPeople = unverifiedPeople.length;
  const toInsert: Record<string, unknown>[] = [];
  for (const p of found) {
    if (emailOnLead([...rows, ...created], p.email) || toInsert.some((r) => r.email === p.email)) continue;
    const same = findSamePerson([...rows, ...created], p.first_name, p.last_name);
    if (same) {
      // The same person is already on the lead (for example a registry officer): fill their blanks, never add twice.
      if (!same.dismissed_at && !str(same.email)) {
        const saved = await fillBlanks(service, same, { email: p.email, title: p.title, ...(p.linkedin_url ? { linkedin_url: p.linkedin_url } : {}) });
        if (saved) { Object.assign(same, saved); touched.add(same.id); stats.officerEmails++; }
      }
      continue;
    }
    toInsert.push({
      lead_id: lead.id, source: 'hunter', kind: 'person', first_name: p.first_name, last_name: p.last_name, title: p.title,
      email: p.email, email_revealed: true, name_obfuscated: false, linkedin_url: p.linkedin_url,
      include_in_sequences: false, is_primary: false, created_by: run.created_by,
    });
  }
  const insertedHunter = await insertContacts(service, toInsert);
  created.push(...insertedHunter);
  for (const c of insertedHunter) touched.add(c.id);
  stats.hunterPeople = insertedHunter.length;

  // (3) everyone to look up (contacts without an email, officers, names on the lead) on CONFIRMED domains only
  const people = peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers);
  const verifiedDomains = domains.filter((d) => verified.has(d)).slice(0, 4);
  const peopleOut = await lookUpPeople({
    service, run, lead: { id: lead.id, website: str(lead.website), business_name: str(lead.business_name) }, people,
    contacts: all, domains: verifiedDomains, website: usableSite ? str(lead.website) : null,
    websiteDirectory: !!siteDomain && isDirectoryDomain(siteDomain), lists, keys: { hunterKey, geminiKey },
    spend: { hunter: () => spend.hunter('people'), ai: () => spend.ai('people'), stopHunter: () => spend.stopHunter() }, left,
  });
  created.push(...peopleOut.created);
  for (const c of peopleOut.touched) touched.add(c.id);
  stats.officerEmails += peopleOut.emailsFound;
  for (const s of peopleOut.suggestions) {
    if (suggestions.some((x) => x.field === s.field && x.value.toLowerCase() === s.value.toLowerCase())) continue;
    suggestions.push(s);
  }
  problems.push(...peopleOut.problems);
  if (people.length > 0) steps.push(`Looked up ${people.length} known ${people.length === 1 ? 'person' : 'people'}: ${peopleOut.emailsFound} email${peopleOut.emailsFound === 1 ? '' : 's'} found.`);

  // (4) team pages and (5) the web search: names only, never stored unless already a contact
  const sitePeople: SitePerson[] = [];
  for (const p of [...pages.flatMap((html) => extractTeamMembers(html)), ...extraSitePeople]) {
    if (!sitePeople.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) sitePeople.push(p);
  }
  const namedOnSite = sitePeople.filter((p) => !namedPersonIsStored(p.name, all())).slice(0, 10);
  const namedByWeb = webPeople.filter((p) => !namedPersonIsStored(p.name, all())).slice(0, 10)
    .map((p) => ({ ...p, also_on_site: namedOnSite.some((s) => s.name.toLowerCase() === p.name.toLowerCase()) }));
  stats.namedOnSite = namedOnSite.length;
  stats.namedByWeb = namedByWeb.length;
  stats.hunterCapHit = spend.hunterHit;
  stats.aiCapHit = spend.aiHit;
  // One plain line per search that gave no answer (replaces the old "N searches did not work" count), then the credits.
  steps.push(...worker.lines());
  steps.push(...problemLines(problems));
  steps.push(creditLine(spend.used));

  // LinkedIn auto-capture, like findDecisionMakers, for contacts this run created or filled
  for (const c of all()) {
    if (!touched.has(c.id) || !str(c.linkedin_url) || c.dismissed_at) continue;
    const fullName = `${str(c.first_name) ?? ''} ${str(c.last_name) ?? ''}`.trim() || 'Unknown';
    const { error } = await service.from('linkedin_contacts').upsert({
      org_id: run.org_id, lead_id: lead.id, decision_maker_candidate_id: c.id, full_name: fullName,
      linkedin_url: c.linkedin_url, context_signal: null, created_by: run.created_by,
    }, { onConflict: 'decision_maker_candidate_id', ignoreDuplicates: true });
    if (error) console.error('deep find: linkedin capture failed');
  }

  return {
    status: 'done',
    reason: deepFindSummary(stats),
    people_found: stats.hunterPeople + stats.officersAdded,
    domains: {
      domains: discovery.domains,
      named_by_web: namedByWeb,
      named_on_site: namedOnSite,
      suggestions: suggestions.slice(0, 10),
      unverified_people: unverifiedPeople,
      registered_name: registry.name,
      website_suspect: suspicion.suspect,
      website_reasons: suspicion.reasons,
      company_number: registry.number,
      company_candidates: registry.candidates.map((c) => ({
        company_number: c.company_number, name: c.name, address: c.address, status: c.status, score: c.score, why: c.why ?? null,
      })),
      people: peopleOut.results,
      steps,
      credits: spend.used,
      hunter_account: hunterAccountInfo,
    },
  };
}

async function updateRow(service: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await service.from('deep_find_leads').update({ ...patch, updated_at: nowIso() }).eq('id', id).eq('status', 'running');
  if (error) console.error('deep find: row update failed');
}

/** Completes an active run once none of its rows is queued or running. */
async function completeIfDone(service: SupabaseClient, runId: string): Promise<void> {
  const { count } = await service.from('deep_find_leads').select('id', { count: 'exact', head: true })
    .eq('run_id', runId).in('status', ['queued', 'running']);
  if ((count ?? 1) > 0) return;
  const { error } = await service.from('deep_find_runs').update({ status: 'completed', finished_at: nowIso() }).eq('id', runId).eq('status', 'active');
  if (error) console.error('deep find: complete run failed');
}

/** Cancels a run (engine side) and skips its queued rows. */
export async function cancelDeepFindRun(service: SupabaseClient, runId: string, reason: string): Promise<void> {
  await service.from('deep_find_runs').update({ status: 'cancelled', cancel_reason: reason.slice(0, 300), finished_at: nowIso() })
    .eq('id', runId).eq('status', 'active');
  await service.from('deep_find_leads').update({ status: 'skipped', reason: 'The Deep find was stopped before this lead.', updated_at: nowIso() })
    .eq('run_id', runId).eq('status', 'queued');
}

/** Housekeeping: interrupted rows are requeued once then failed; queued rows of ended runs are skipped; empty runs complete. */
async function housekeeping(service: SupabaseClient): Promise<void> {
  const { data: running } = await service.from('deep_find_leads').select('id, claimed_at, attempts').eq('status', 'running');
  const now = new Date();
  for (const r of (running ?? []) as { id: string; claimed_at: string | null; attempts: number }[]) {
    const action = stuckAction(r, now);
    if (action === 'ignore') continue;
    const patch = action === 'requeue'
      ? { status: 'queued', claimed_at: null }
      : { status: 'failed', reason: 'This lead was interrupted twice, so Deep find stopped trying.', finished_at: nowIso() };
    await service.from('deep_find_leads').update({ ...patch, updated_at: nowIso() }).eq('id', r.id).eq('status', 'running');
  }
  const { data: orphans } = await service.from('deep_find_leads').select('id, deep_find_runs!inner(status)')
    .eq('status', 'queued').neq('deep_find_runs.status', 'active');
  const ids = ((orphans ?? []) as { id: string }[]).map((o) => o.id);
  if (ids.length > 0) {
    await service.from('deep_find_leads').update({ status: 'skipped', reason: 'The Deep find was stopped before this lead.', updated_at: nowIso() })
      .in('id', ids).eq('status', 'queued');
  }
  const { data: active } = await service.from('deep_find_runs').select('id').eq('status', 'active');
  for (const r of (active ?? []) as { id: string }[]) await completeIfDone(service, r.id);
}

/**
 * One tick: housekeeping, then claims and processes one lead at a time (atomic deep_find_claim) while enough of the
 * invocation is left. Before each lead the run must still be active and its creator still a member of the org.
 */
export async function runDeepFindTick(service: SupabaseClient, startedAt: number): Promise<number> {
  try { await housekeeping(service); } catch { console.error('deep find: housekeeping failed'); }
  let processed = 0;
  const members = new Map<string, boolean>();
  while (Date.now() - startedAt < WALL_BUDGET_MS - LEAD_RESERVE_MS) {
    const { data: claimed, error } = await service.rpc('deep_find_claim', { max_leads: 1 });
    if (error) { console.error('deep find: claim failed'); break; }
    const row = ((claimed ?? []) as ClaimedRow[])[0];
    if (!row) break;
    const { data: runData } = await service.from('deep_find_runs').select('id, org_id, created_by, status').eq('id', row.run_id).maybeSingle();
    const run = runData as DeepFindRun | null;
    if (!run || run.status !== 'active') {
      await updateRow(service, row.id, { status: 'skipped', reason: 'The Deep find was stopped before this lead.', finished_at: nowIso() });
      continue;
    }
    const memberKey = `${run.org_id}:${run.created_by}`;
    if (!members.has(memberKey)) {
      const { data: m, error: mErr } = await service.from('org_members').select('user_id').eq('org_id', run.org_id).eq('user_id', run.created_by).maybeSingle();
      if (mErr) { await updateRow(service, row.id, { status: 'queued', claimed_at: null }); break; }
      members.set(memberKey, !!m);
    }
    if (!members.get(memberKey)) {
      await updateRow(service, row.id, { status: 'skipped', reason: 'The person who started this Deep find is no longer in the organisation.', finished_at: nowIso() });
      await cancelDeepFindRun(service, run.id, 'The person who started this Deep find is no longer in the organisation');
      continue;
    }
    let out: LeadOutcome;
    try { out = await processDeepFindLead(service, run, row); } catch { out = { status: 'failed', reason: 'Something went wrong while searching this lead.' }; }
    await updateRow(service, row.id, {
      status: out.status, reason: out.reason.slice(0, 1000), people_found: out.people_found ?? 0,
      ...(out.domains ? { domains: out.domains } : {}), finished_at: nowIso(),
    });
    await completeIfDone(service, run.id);
    processed++;
  }
  return processed;
}
