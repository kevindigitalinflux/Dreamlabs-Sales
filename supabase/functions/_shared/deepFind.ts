// supabase/functions/_shared/deepFind.ts
// Deep find engine: claims queued leads, discovers the company's domains and people, stores people as contacts that are
// NOT in sequences, and writes a plain-English summary per lead. Never emails anyone and never touches sequences.
// Runs with the service client, so every org boundary is re-checked here. Keys only go to providers in headers.
import { lookupMx, cachedMailProvider } from './dnsLookup.ts';
import { displayPersonKey, fullestPeople } from './personIdentity.ts';
import { EFFORT_LEVELS, companyDomainHunterCap, effortPolicy, deepPhaseDecision, type Effort } from './deepFindEffort.ts';
import { cleanCompanyNumber } from './registrySearch.ts';
import { registryWebNumbers } from './registryWebProof.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from './orgApiKeys.ts';
import { checkRateLimit } from './rateLimit.ts';
import { fetchActiveOfficers } from './companiesHouse.ts';
import { registryStep, resolveRegistry } from './deepFindRegistry.ts';
import { lookUpPeople } from './deepFindPeople.ts';
import { discoverLeadDomains } from './domainDiscoveryLookup.ts';
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';
import { webSearchDomainFormat, hunterAccount, hunterDomainList, hunterVerifyEmail, readCompanyPages, webSearchForPerson, type LookupResult, type WebSearchPerson } from './knownPersonLookup.ts';
import { guessLabel, inferDomainPattern, patternGuess, patternLine, type PatternSample } from './domainPattern.ts';
import { hunterAccountEmpty, hunterAccountLine, type HunterAccount } from './hunterLimits.ts';
import { cleanEmail, cleanLinkedinProfile, emailDomain, extractWebsiteFindings, isFreeMailDomain, pickWebsiteFindings } from './knownPersonWide.ts';
import { domainEmailsOnPages } from './domainSiteCheck.ts';
import { extractPhone } from './websiteContact.ts';
import { domainFromWebsite, isDirectoryDomain } from './knownPerson.ts';
import { rankPeople } from './peopleRanking.ts';
import { DOMAIN_SOURCE_LABELS, safeFailure, websiteSuspicion, type KnownPersonName, type WebPerson } from './domainDiscovery.ts';
import { creditLine, problemLines, type ProblemInput } from './deepFindProblems.ts';
import {
  MAX_HUNTER_PEOPLE_PER_LEAD, deepFindSummary, emailOnLead, extractTeamMembers, findSamePerson, samePersonMatches,
  hunterPeople, namedPersonIsStored, parseLeadPersonName, peopleToLookUp, stuckAction, type ExistingContact, type LeadStats, type SitePerson,
} from './deepFindRules.ts';
import { makeWorkerClient } from './workerClient.ts';
import { MAX_VERIFY_PER_LEAD, WORKER_TIMEOUT_MS, scrapeTimeoutFor, unconfirmedLabel, verifyAction, type WorkerFailure } from './workerRules.ts';
import { rankedEmailCandidates, unverifiedEmailSuggestions, providerGuessLine, GuessBudget, GuessChecks, optionalPeopleBudget, personEmailLine, COMMON_GUESS_LABEL } from './personEmailFinding.ts';
import { makeFirecrawlClient } from './firecrawlClient.ts';
import { FIRECRAWL_DAILY_PAGES, firecrawlDomainFor } from './firecrawlRules.ts';
import { classifyDeepFindCheckpoint, DeepFindAuthorisationLost } from './deepFindCheckpoint.ts';
import { isOwnerRole, isReviewPhone, isSuggestionDismissed, roleForPerson, visibleSuggestions } from './deepFindSuggestions.ts';
import type { ReviewLead } from './deepFindSuggestions.ts';
import { applyDeepFindBlank } from './deepFindApply.ts';
import { lookupPlaceContact } from './googlePlacesLookup.ts';
import { lookupApolloPhone } from './apolloHunterLookup.ts';
import { searchApolloDecisionMakers } from './apolloPeopleSearch.ts';
import { lookupOpenCorporatesOfficer } from './openCorporates.ts';
import { linkedinMatch, planWebsiteAutoUpdate, type AutoApplied } from './deepFindAutoApply.ts';

export const WALL_BUDGET_MS = 130_000;
/** A lead is only started when at least this much of the invocation is left. */
const LEAD_RESERVE_MS = 80_000;
const LEAD_BUDGET_MS = 70_000;
const nowIso = () => new Date().toISOString();

/** The run columns the engine reads. */
export interface DeepFindRun { id: string; org_id: string; created_by: string; status: string; credit_cap_hunter?: number; lead_count?: number }
interface ClaimedRow { id: string; run_id: string; org_id: string; lead_id: string; attempts: number; domains?: Record<string, unknown> }
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
  enabled = true;
  private hunterCount = 0;
  private aiCount = 0;
  constructor(private service: SupabaseClient, private runId: string, private effort: Effort = 'custom') {}
  private within(kind: 'hunter' | 'ai', count: number) {
    return this.effort === 'custom' || count < EFFORT_LEVELS[this.effort][kind];
  }
  private async reserve(hunter: number, ai: number): Promise<boolean> {
    const { data, error } = await this.service.rpc('deep_find_reserve', { run_id: this.runId, hunter, ai });
    return !error && data === true;
  }
  /** Set when Hunter's searches are used up or it asked us to slow down: no more Hunter calls for this lead. */
  hunterStopped = false;
  stopHunter(): void { this.hunterStopped = true; }
  async hunter(step = 'other'): Promise<boolean> {
    if (!this.enabled || !this.within('hunter', this.hunterCount) || this.hunterHit || this.hunterStopped) return false;
    const ok = await this.reserve(1, 0);
    if (!ok) this.hunterHit = true;
    else { this.hunterCount++; this.used.hunter[step] = (this.used.hunter[step] ?? 0) + 1; }
    return ok;
  }
  async ai(step = 'other'): Promise<boolean> {
    if (!this.enabled || !this.within('ai', this.aiCount) || this.aiHit) return false;
    const ok = await this.reserve(0, 1);
    if (!ok) this.aiHit = true;
    else { this.aiCount++; this.used.ai[step] = (this.used.ai[step] ?? 0) + 1; }
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

/** One lead, start to finish. Returns the outcome to store; never throws for provider problems. */
export async function processDeepFindLead(service: SupabaseClient, run: DeepFindRun, row: ClaimedRow): Promise<LeadOutcome> {
  const effort = effortPolicy(row.domains);
  const metadata = { ...(row.domains?.start_fresh === true ? { start_fresh: true } : {}), effort, effort_caps: effort === 'custom' ? row.domains?.effort_caps : { hunter: EFFORT_LEVELS[effort].hunter, ai: EFFORT_LEVELS[effort].ai, firecrawl: EFFORT_LEVELS[effort].firecrawl } };
  const deadline = Date.now() + LEAD_BUDGET_MS;
  const left = () => deadline - Date.now();
  const { data: leadData, error: leadErr } = await service.from('leads').select('*').eq('id', row.lead_id).maybeSingle();
  if (leadErr) return { status: 'failed', reason: 'Could not load this lead.' };
  const lead = leadData as (Record<string, unknown> & ReviewLead & { id: string; org_id: string }) | null;
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

  let [hunterKey, geminiKey, chKey, apolloKey, firecrawlKey, placesKey, ocKey] = await Promise.all([
    resolveOrgApiKey(service, run.org_id, 'hunter'),
    resolveOrgApiKey(service, run.org_id, 'gemini'),
    resolveOrgApiKey(service, run.org_id, 'companies_house'),
    resolveOrgApiKey(service, run.org_id, 'apollo'),
    resolveOrgApiKey(service, run.org_id, 'firecrawl'),
    resolveOrgApiKey(service, run.org_id, 'google_places'),
    resolveOrgApiKey(service, run.org_id, 'opencorporates'),
  ]);
  const configured = { hunterKey, geminiKey, apolloKey, firecrawlKey, placesKey, ocKey };
  let deepEnabled = effort === 'custom';
  if (!deepEnabled) { hunterKey = null; geminiKey = null; apolloKey = null; firecrawlKey = null; placesKey = null; ocKey = null; }
  const spend = new Spend(service, run.id, effort);
  spend.enabled = deepEnabled;
  const checkpoint = async () => {
      const { data: active, error } = await service.from('deep_find_runs').select('status').eq('id', run.id).eq('org_id', run.org_id).maybeSingle();
      // Stop on a confirmed ended run before another read can fail and mask that decision.
      const runAccess = classifyDeepFindCheckpoint({ runStatus: active?.status, runReadFailed: !!error,
        canEdit: null, accessReadFailed: true });
      if (runAccess === 'authorisation_lost') throw new DeepFindAuthorisationLost();
      const { data: allowed, error: accessError } = await service.rpc('deep_find_creator_can_edit', { target_user: run.created_by, target_lead: lead.id });
      const access = classifyDeepFindCheckpoint({ runStatus: active?.status, runReadFailed: !!error,
        canEdit: allowed, accessReadFailed: !!accessError });
      if (access === 'authorisation_lost') throw new DeepFindAuthorisationLost();
      if (access === 'unavailable') throw new Error('Deep find checkpoint could not be checked.');

  };
  const firecrawl = makeFirecrawlClient({ key: configured.firecrawlKey, maxPages: effort === 'custom' ? 1 : EFFORT_LEVELS[effort].firecrawl,
    reserve: () => checkRateLimit(service, `firecrawl-pages:${run.org_id}`, FIRECRAWL_DAILY_PAGES, 1440, true), checkpoint,
  });
  // Own worker key first; shared worker requires the global fallback flag or WORKER_SHARED_ORG_IDS.
  const workerConfig = await resolveOrgWorkerConfig(service, run.org_id, Deno.env.get('WORKER_SHARED_ORG_IDS'));
  const worker = makeWorkerClient({ usage: service, orgId: run.org_id, config: workerConfig });
  const { data: contactData, error: contactErr } = await service.from('decision_maker_candidates').select('*').eq('lead_id', lead.id);
  if (contactErr) return { status: 'failed', reason: 'Could not read this lead\'s contacts.' };
  const rows = (contactData ?? []) as Contact[];
  const created: Contact[] = [];
  const stats: LeadStats = {
    hunterPeople: 0, officersAdded: 0, officerEmails: 0, domainsShown: [], domainsToCheck: 0, namedByWeb: 0, namedOnSite: 0,
    hunterCapHit: false, aiCapHit: false, noHunterKey: !configured.hunterKey, noWebsite: false, unverifiedPeople: 0,
  };
  /** Steps that gave no answer, turned into one plain line each at the end. */
  const problems: ProblemInput[] = [];
  /** Contacts this run created or filled, the only ones whose LinkedIn link is captured. */
  const touched = new Set<string>();
  const suggestions: { name: string; field: string; value: string; label: string; guess_rank?: 'most_likely' | 'other'; replaces_saved_email?: { contact_id: string; email: string } }[] = [];
  const autoApplied: AutoApplied[] = [];
  let apolloPeople = 0;
  /** Plain-English step lines shown with the results. */
  const steps: string[] = row.domains?.start_fresh === true && Array.isArray(row.domains.steps) ? row.domains.steps.filter((s): s is string => typeof s === 'string' && s.startsWith('Start fresh:')) : [];
  const dismissedPeople: { name: string; contact_id?: string }[] = [];
  const dismissedNames = new Map<string, { name: string; automatic: boolean }>();
  const recordDismissed = (name: string, contactId?: string) => {
    if (!name.trim()) return;
    const key = displayPersonKey(name);
    const contact = contactId ? rows.find(c => c.id === contactId) : null;
    const automatic = !!contact?.dismissed_at && ['companies_house', 'cro', 'hunter', 'apollo'].includes(contact.source ?? '');
    const existing = dismissedNames.get(key);
    if (existing) { existing.automatic ||= automatic; return; }
    dismissedNames.set(key, { name, automatic });
    if (dismissedPeople.length < 10) dismissedPeople.push({ name, ...(contactId ? { contact_id: contactId } : {}) });
  };
  const dismissedStepLines = () => {
    const people = [...dismissedNames.values()];
    const advice = (automatic: boolean) => automatic ? 'Use Start fresh or Restore them from the lead page.' : 'Restore them from the lead page.';
    const lines = people.slice(0, 3).map(p =>
      `${p.name} was dismissed earlier, so Deep find skipped them. ${advice(p.automatic)}`);
    if (!people.slice(0, 3).some(p => p.automatic) && people.slice(3).some(p => p.automatic)) {
      lines[2] += ' Use Start fresh to restore people found automatically.';
    }
    if (people.length > 3) lines.push(`and ${people.length - 3} more people were dismissed earlier.`);
    return lines;
  };
  let registryEvidence: Record<string, unknown> = {};
  if (effort !== 'low' && !configured.geminiKey) steps.push('LinkedIn search skipped: no Gemini key is configured.');
  const all = () => [...rows, ...created];
  const scope = { leadId: lead.id, orgId: run.org_id };
  const ownerSuppressed = (name: string) => {
    const parsed = parseLeadPersonName(name);
    const contact = parsed ? findSamePerson(all(), parsed.first, parsed.last) : null;
    const displayKey = displayPersonKey(name);
    const keys = Array.isArray(lead.dismissed_suggestions) ? lead.dismissed_suggestions : [];
    const namedDismissal = !!displayKey && keys.some(key => typeof key === 'string'
      && /^(owner:|owner_name:|person:)/i.test(key.trim()) && displayPersonKey(key.slice(key.indexOf(':') + 1)) === displayKey);
    const suppressed = namedDismissal || isSuggestionDismissed({ name, field: 'owner_name', value: name }, lead) || !!contact?.dismissed_at;
    if (suppressed) recordDismissed(name, contact?.id);
    return suppressed;
  };
  for (const contact of rows) if (contact.dismissed_at) recordDismissed([str(contact.first_name), str(contact.last_name)].filter(Boolean).join(' '), contact.id);
  for (const raw of [lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners : [])]) if (typeof raw === 'string') ownerSuppressed(raw);

  const applyLead = async (field: string, value: string) => {
    if (field === 'owner_name' && ownerSuppressed(value)) return false;
    const saved = await applyDeepFindBlank(service, scope, 'leads', lead, field, value, autoApplied, checkpoint);
    if (field === 'website' && !saved) {
      const { data: current } = await service.from('leads').select('website').eq('id', lead.id).eq('org_id', run.org_id).maybeSingle();
      if (current && current.website !== lead.website) steps.push('The saved website changed while Deep find ran, so it was left as is.');
    }
    return saved;
  };
  const exactContact = (first: string, last: string) => {
    const normal = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (normal(first).length < 2 || normal(last).length < 2) return null;
    const hits = all().filter(c => c.name_obfuscated !== true && normal(c.first_name) === normal(first) && normal(c.last_name) === normal(last));
    return hits.length === 1 ? hits[0] : null;
  };
  const prepareContact = async (row: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    await checkpoint();
    const { data: current, error } = await service.from('leads').select('dismissed_suggestions').eq('id', lead.id).eq('org_id', run.org_id).maybeSingle();
    if (error || !current) return null;
    const name = (String(row.first_name ?? '') + ' ' + String(row.last_name ?? '')).trim();
    if (ownerSuppressed(name) || isSuggestionDismissed({ name, field: 'owner_name', value: name }, current)) { recordDismissed(name); return null; }
    const prepared = { ...row };
    for (const field of ['title', 'email', 'phone', 'linkedin_url']) {
      const value = str(prepared[field]);
      if (value && isSuggestionDismissed({ name, field, value }, current)) prepared[field] = null;
    }
    return prepared;
  };
  const prepareContacts = async (proposals: Record<string, unknown>[]) => {
    const prepared: Record<string, unknown>[] = [];
    for (const proposal of proposals) { const row = await prepareContact(proposal); if (row) prepared.push(row); }
    return prepared;
  };
  const checkedEmails = new Map<string, Awaited<ReturnType<typeof worker.verifyEmail>>>();
  const invalidGuesses = new Set<string>();
  const invalidSavedEmail = (contact: ExistingContact | null | undefined) => {
    const email = str(contact?.email);
    const checked = email ? checkedEmails.get(email.toLowerCase()) : null;
    return !!checked?.ok && checked.value.status === 'invalid';
  };
  // Selection-only copies: saved addresses remain untouched, even when the checker rejects them.
  const lookupContacts = () => all().map(c => invalidSavedEmail(c) ? { ...c, email: null } : c);
  const formatEvidence = (email: string) => {
    const checked = checkedEmails.get(email.toLowerCase());
    return !checked?.ok || checked.value.status !== 'invalid';
  };
  const contactFormatEvidence = (c: Contact) => {
    const email = str(c.email);
    if (!email || !formatEvidence(email)) return false;
    const checked = checkedEmails.get(email.toLowerCase());
    return (checked?.ok && checked.value.status === 'valid')
      || !/\bguess(?:ed)?\b|most likely address/i.test([str(c.source), str(c.label)].filter(Boolean).join(' '));
  };
  const reviewableSuggestions = () => visibleSuggestions(suggestions.filter((s) => {
    if (ownerSuppressed(s.name)) return false;
    const checked = s.field === 'email' ? checkedEmails.get(s.value.toLowerCase()) : null;
    return !checked?.ok || checked.value.status !== 'invalid';
  }), lead, all());
  const checkEmail = async (email: string, opts?: { timeoutMs?: number }) => {
    const key = email.toLowerCase();
    const cached = checkedEmails.get(key);
    if (cached) return cached;
    const checkDeadline = opts?.timeoutMs === undefined ? null : Date.now() + opts.timeoutMs;
    await checkpoint();
    const remaining = checkDeadline === null ? null : checkDeadline - Date.now();
    if (remaining !== null && remaining < 1) return { ok: false as const, failure: 'timeout' as const, line: 'The email checker took too long to answer for this address.' };
    const result = remaining === null ? await worker.verifyEmail(email) : await worker.verifyEmail(email, { timeoutMs: remaining });
    checkedEmails.set(key, result);
    if (result.ok && result.value.status === 'invalid') {
      invalidGuesses.add(key);
      for (const c of all()) {
        if (str(c.email)?.toLowerCase() !== key || c.dismissed_at || c.kind === 'general' || c.name_obfuscated === true) continue;
        const name = `${str(c.first_name) ?? ''} ${str(c.last_name) ?? ''}`.trim();
        if (name && !ownerSuppressed(name)) steps.push(`${name}: the saved address ${str(c.email)} was checked and does not exist. Trying other formats.`);
      }
    }
    return result;
  };
  // All contact email sources need our checker's valid verdict and share the existing worker cap.
  const saveContact = async (contact: Contact, patch: Record<string, string>): Promise<Contact | null> => {
    let changed = false;
    const name = `${str(contact.first_name) ?? ''} ${str(contact.last_name) ?? ''}`.trim();
    const candidates = all();
    // A wide lookup can fill its newly inserted row before returning it to this engine.
    if (!candidates.some(c => c.id === contact.id)) candidates.push(contact);
    const unique = findSamePerson(candidates, contact.first_name, contact.last_name);
    if (ownerSuppressed(name)) return null;
    if (!unique || unique.dismissed_at || unique.id !== contact.id) {
      for (const [field, value] of Object.entries(patch)) {
        if (str(value)) suggestions.push({ name, field, value, label: 'Person match is ambiguous; review the full name before adding.' });
      }
      return null;
    }
    for (const [field, value] of Object.entries(patch)) {
      if (field === 'email' && invalidSavedEmail(contact)) {
        if (str(value) && formatEvidence(value)) suggestions.push({ name, field, value, label: 'Replacement candidate; review before adding.' });
        continue;
      }
      if (str(contact[field]) || !str(value)) continue;
      if (field === 'email') {
        const checked = left() > WORKER_TIMEOUT_MS.verify + 2_000 ? await checkEmail(value) : checkedEmails.get(value.toLowerCase());
        if (checked?.ok && checked.value.status === 'valid') {
          changed = await applyDeepFindBlank(service, scope, 'decision_maker_candidates', contact, field, value, autoApplied, checkpoint) || changed;
        } else if (!checked?.ok || checked.value.status !== 'invalid') {
          suggestions.push({ name, field, value, label: 'Found during Deep find; our checker has not confirmed this address. Review it.' });
        }
      } else if (field === 'linkedin_url') suggestions.push({ name, field, value, label: 'Provider profile; check the person and company before adding.' });
      else if (field === 'title') suggestions.push({ name, field, value, label: 'Provider role; review before adding.' });
    }
    if (changed) touched.add(contact.id);
    return changed ? contact : null;
  };
  try {
  let hunterAccountInfo: HunterAccount | null = null;
  const checkHunterAllowance = async () => {
    // Hunter's free account check (no search credits): how many searches are left, and stop early when none are.

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

  };
  if (effort === 'custom') await checkHunterAllowance();

  // Resolve an already saved identity before judging a trading-brand website. No name search here.
  const savedRegistryNumber = cleanCompanyNumber(lead.company_number);
  const knownRegistry = savedRegistryNumber || str(lead.raw_lead_id)
    ? await resolveRegistry(service, lead, savedRegistryNumber ? chKey : null) : null;
  // the website pages, read once
  const siteDomain = domainFromWebsite(str(lead.website));
  // A website domain the user marked "Not their domain" is never read or searched.
  const siteBlocked = !!siteDomain && savedDomains(lead.blocked_domains).includes(siteDomain);
  if (siteBlocked) steps.push('The lead\'s website domain was marked as not theirs, so the website was not used. You can restore it from the lead page.');
  const siteReadable = !!siteDomain && !siteBlocked && DOMAIN_CHECKS.usable(siteDomain);
  const siteChecked = siteReadable && left() > 30_000;
  const sitePages = siteChecked ? await readCompanyPages(str(lead.website)!, 12_000) : [];
  // A website that shows clear signs of another company is only a weak signal: not read for people or other domains.
  const suspicion = websiteSuspicion(sitePages, [str(lead.business_name) ?? '', knownRegistry?.name ?? ''].filter(Boolean), lead.country, lead);
  if (suspicion.suspect) steps.push(`This website may belong to a different company: ${suspicion.reasons.join(' ')}`);
  const usableSite = siteReadable && !suspicion.suspect;
  stats.noWebsite = !str(lead.website);
  const pages = usableSite ? sitePages : [];

  // (0) the registered company and its officers (officers become companies_house contacts, as before)
  // People we already know (owner names on the lead, contacts): used to find the company through Companies House officers.
  const registryPeople = [
    ...[lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners.slice(0, 10) : [])]
      .flatMap((n) => { const p = parseLeadPersonName(n); return p ? [{ first: p.first, last: p.last }] : []; }),
    ...rows.flatMap((c) => (str(c.first_name) && str(c.last_name) && !c.dismissed_at && c.name_obfuscated !== true ? [{ first: str(c.first_name)!, last: str(c.last_name)! }] : [])),
    ...pages.flatMap(extractTeamMembers).flatMap(p => { const n = parseLeadPersonName(p.name); return n ? [{ first: n.first, last: n.last }] : []; }),
  ].slice(0, 6);
  let registry = knownRegistry?.number ? knownRegistry : await resolveRegistry(service, lead, chKey, registryPeople, { pages, website: usableSite ? str(lead.website) : null, left, checkpoint, applyNumber: number => applyLead('company_number', number) });
  registryEvidence = registry.evidence ?? {};
  steps.push(registryStep(registry));
  if (lead.country === 'IE' && await resolveOrgApiKey(service, run.org_id, 'cro')) {
    steps.push('CRO lookup when its key arrives; Irish register lookup is not built yet.');
  }
  let officers: Awaited<ReturnType<typeof fetchActiveOfficers>> = [];
  const addRegistryOfficers = async () => {
    officers = fullestPeople(registry.number && chKey ? await fetchActiveOfficers(registry.number, chKey) : [], o => String(o.first_name ?? '') + ' ' + String(o.last_name ?? ''));
    const officerRows: Record<string, unknown>[] = [];
    for (const o of officers) {
      if (o.first_name && o.last_name && ownerSuppressed(o.first_name + ' ' + o.last_name)) continue;
      if (!o.first_name || !o.last_name || samePersonMatches(all(), o.first_name, o.last_name).length) continue;
      if (officerRows.some((r) => r.first_name === o.first_name && r.last_name === o.last_name)) continue;
      officerRows.push({ lead_id: lead.id, source: 'companies_house', first_name: o.first_name, last_name: o.last_name, title: o.title, created_by: run.created_by });
    }
    if (officerRows.length > 0) {
      await checkpoint();
      const { data, error } = await service.from('decision_maker_candidates').insert(await prepareContacts(officerRows.map((r) => ({ ...r, include_in_sequences: false })))).select('*');
      if (error) problems.push({ step: 'save', target: 'the Companies House officers', failure: 'network' });
      else { created.push(...((data ?? []) as Contact[])); stats.officersAdded = (data ?? []).length; }
    }
    if (!str(lead.owner_name)) {
      const officer = officers.find((o) => isOwnerRole(o.title));
      if (officer?.first_name && officer.last_name) {
        const name = (officer.first_name + ' ' + officer.last_name).trim();
        const exact = exactContact(officer.first_name, officer.last_name);
        if (exact && !exact.dismissed_at) await applyLead('owner_name', name);
        else suggestions.push({ name, field: 'owner_name', value: name, label: 'Registry owner role; review the full name before adding.' });
      }
      else for (const o of officers.slice(0, 5)) suggestions.push({ name: `${o.first_name} ${o.last_name}`.trim(), field: 'owner_name', value: `${o.first_name} ${o.last_name}`.trim(), label: `Companies House: ${o.title ?? 'officer'}. Check ownership before adding.` });
      if (!officers.length && ocKey && left() > 30_000) {
        await checkpoint();
        const name = await lookupOpenCorporatesOfficer(str(lead.business_name) ?? '', ocKey);
        if (name) suggestions.push({ name, field: 'owner_name', value: name, label: 'OpenCorporates officer match; check company and ownership before adding.' });
      }
    }
    for (const officer of officers.filter((o) => isOwnerRole(o.title))) {
      if (!officer.first_name || !officer.last_name) continue;
      const contact = exactContact(officer.first_name, officer.last_name);
      if (contact && !ownerSuppressed(`${officer.first_name} ${officer.last_name}`)) {
        await applyDeepFindBlank(service, scope, 'decision_maker_candidates', contact, 'title', officer.title!, autoApplied, checkpoint);
      }
    }
    if (registry.number) steps.push(`Companies House officers: ${officers.length} active, ${stats.officersAdded} added as contacts.`);

  };
  await addRegistryOfficers();

  // Everyone known to work there (contacts, officers, names on the lead): a domain where Hunter lists one of them is confirmed.
  const knownPeople: KnownPersonName[] = [
    ...all().flatMap((c) => (str(c.first_name) && str(c.last_name) && !c.dismissed_at && c.name_obfuscated !== true ? [{ first: str(c.first_name)!, last: str(c.last_name)! }] : [])),
    ...officers.flatMap((o) => (o.first_name && o.last_name ? [{ first: o.first_name, last: o.last_name }] : [])),
    ...[lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners.slice(0, 10) : [])]
      .flatMap((n) => { const p = parseLeadPersonName(n); return p ? [{ first: p.first, last: p.last }] : []; }),
  ].slice(0, 20);

  const leadEmailDomain = emailDomain(str(lead.email));
  const discoveryCap = companyDomainHunterCap(effort, !!(usableSite || (leadEmailDomain && !isFreeMailDomain(leadEmailDomain)) || savedDomains(lead.email_domains).some(d => !isFreeMailDomain(d))), run.credit_cap_hunter ?? 0, run.lead_count ?? 1);
  // (1) the company's domains
  const contactDomains = rows.map((r) => emailDomain(str(r.email))).filter((d): d is string => !!d);
  const discovery = await discoverLeadDomains(service, {
    id: lead.id, org_id: lead.org_id, business_name: str(lead.business_name), website: str(lead.website), email: str(lead.email),
    city: str(lead.city), postcode: str(lead.postcode), email_domains: lead.email_domains, blocked_domains: lead.blocked_domains,
  }, {
    registeredName: registry.name, registeredAddress: registry.address, people: knownPeople, websiteSuspect: suspicion.suspect,
    extraKnown: contactDomains.map((domain) => ({ domain, source: 'contact_email' as const })),
    keys: { hunterKey, geminiKey, apolloKey }, allow: { hunter: deepEnabled, site: pages.length > 0, web: deepEnabled, apollo: deepEnabled },
    budgetMs: Math.min(30_000, Math.max(0, left() - 30_000)), pages, hunterCap: discoveryCap,
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

  // Confirmed own-site discovery takes precedence over Places.
  const websitePatch = !str(lead.website) ? planWebsiteAutoUpdate(lead, discovery.domains, { checked: siteChecked, reachable: sitePages.length > 0, suspect: suspicion.suspect }) : null;
  if (websitePatch) await applyLead('website', websitePatch.website);
  let placesSuppliedPhone = false;
  const fillPlaces = async () => {

    if (placesKey && !str(lead.phone) && left() > 30_000) {
      await checkpoint();
      if (!await checkRateLimit(service, 'places-lookups:' + run.org_id, 300, 1440, true)) {
        steps.push("Google Places lookups reached today's limit for this organisation.");
      } else {
        const place = await lookupPlaceContact(str(lead.business_name) ?? '', str(lead.city), placesKey);
        const automatic = !!str(lead.city) && place?.strength === 2 && place.cityMatches === true;
        const label = 'Google Places: ' + (place?.name ?? 'business match') + ', ' + (place?.address ?? 'address unavailable') + '. Review the match before adding.';
        const domain = domainFromWebsite(place?.website ?? null);
        const confirmedOwnSite = discovery.domains.some(d => !d.needs_check && d.sources.includes('site_confirms'));
        if (place?.website && !str(lead.website) && !confirmedOwnSite && domain && DOMAIN_CHECKS.usable(domain) && !savedDomains(lead.blocked_domains).includes(domain)) {
          if (automatic) await applyLead('website', place.website);
          else suggestions.push({ name: 'Company contact', field: 'website', value: place.website, label });
        }
        if (place?.phone && isReviewPhone(place.phone)) {
          placesSuppliedPhone = true;
          if (automatic) await applyLead('phone', place.phone);
          else suggestions.push({ name: 'Company contact', field: 'phone', value: place.phone, label });
        }
        steps.push(place ? 'Checked Google Places for missing website and phone.' : 'Google Places found no matching contact details.');
      }
    }

  };
  if (effort === 'custom') await fillPlaces();

  // (1b) free team scan on discovered domains whose OWN website confirmed them: emails written literally on the
  // site for the people we know (filled for existing contacts, suggestions otherwise) and named staff to check.
  const confirmedSites = discovery.sitePages.filter((s) => verified.has(s.domain));
  const siteEmails = new Map<string, string[]>();
  const extraSitePeople: SitePerson[] = [];
  for (const s of confirmedSites) {
    siteEmails.set(s.domain, domainEmailsOnPages(s.pages, s.domain));
    for (const html of s.pages) extraSitePeople.push(...extractTeamMembers(html));
  }
  const ownSites = [...confirmedSites, ...(siteDomain && verified.has(siteDomain) ? [{ domain: siteDomain, pages }] : [])];
  const ownerSites = new Set(discovery.domains.filter((d) => !d.needs_check && d.sources.includes('site_confirms')).map((d) => d.domain));
  const trustedOwnerPeople = ownSites.filter((s) => ownerSites.has(s.domain)).flatMap((s) => s.pages.flatMap(extractTeamMembers));
  const registryPages = [...pages, ...confirmedSites.filter(s => ownerSites.has(s.domain)).flatMap(s => s.pages)];
  if (registry.how === 'ambiguous' && registryPages.length > pages.length) {
    registryPeople.push(...trustedOwnerPeople.flatMap(p => { const n = parseLeadPersonName(p.name); return n ? [{ first: n.first, last: n.last }] : []; }));
    registry = await resolveRegistry(service, lead, chKey, registryPeople, { pages: registryPages,
      website: usableSite ? str(lead.website) : null, cached: registry.allCandidates ?? registry.candidates,
      cachedPeople: registry.proofPeople, priorEvidence: registry.evidence, left, checkpoint, applyNumber: number => applyLead('company_number', number) });
    registryEvidence = registry.evidence ?? {};
    steps.push(registryStep(registry));
    if (registry.number) await addRegistryOfficers();
  }
  for (const site of ownSites) for (const html of site.pages) {
    for (const email of domainEmailsOnPages([html], site.domain).filter((e) => !emailOnLead(all(), e))) {
      suggestions.push({ name: 'Company contact', field: 'email', value: email, label: `Found on ${site.domain}, check it` });
    }
    const phone = extractPhone(html);
    if (phone && !str(lead.phone)) suggestions.push({ name: 'Company contact', field: 'phone', value: phone, label: 'Found on the company website; review before adding.' });
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
  const lookupPeople = () => peopleToLookUp({ owner_name: lead.owner_name, additional_owners: [
    ...(Array.isArray(lead.additional_owners) ? lead.additional_owners : []),
    ...extraSitePeople.map((p) => p.name), ...pages.flatMap((html) => extractTeamMembers(html).map((p) => p.name)),
    ...webPeople.map((p) => p.name),
  ] }, lookupContacts(), officers).filter(p => !ownerSuppressed(p.first + ' ' + p.last));
  const optionalBudget = () => optionalPeopleBudget(left(), lookupPeople().length > 0);
  const scrapeTimeout = scrapeTimeoutFor(optionalBudget());
  if (scrapeDomain && scrapeTimeout !== null) {
    const scraped = await worker.scrapeSite(scrapeDomain, 'key_pages', { timeoutMs: scrapeTimeout });
    if (scraped.ok) {
      const pageOf = (source: string | null) => { try { return source ? ` (${new URL(source).pathname.slice(0, 80)})` : ''; } catch { return ''; } };
      for (const e of scraped.value.emails) {
        if (emailOnLead(all(), e.value) || suggestions.some((s) => s.value === e.value)) continue;
        suggestions.push({ name: 'Company contact', field: 'email', value: e.value, label: `Found by the browser scraper on ${scrapeDomain}${pageOf(e.source)}, check it` });
      }
      siteEmails.set(scrapeDomain, [...(siteEmails.get(scrapeDomain) ?? []), ...scraped.value.emails.map((e) => e.value)]);
      for (const phone of scraped.value.phones) if (!str(lead.phone)) suggestions.push({ name: 'Company contact', field: 'phone', value: phone.value, label: 'Found by the browser scraper; review before adding.' });
    }
  }
  const readDeeperPages = async () => {
    // Names/roles only: Firecrawl people go to named_on_site for review, never contact inserts.
    const hasNamedRoles = all().some((c) => !!str(c.first_name) && !!str(c.last_name) && !!str(c.title))
      || extraSitePeople.length > 0 || pages.some((html) => extractTeamMembers(html).length > 0)
      || webPeople.some((p) => !!p.name && !!p.role);
    const firecrawlDomain = deepEnabled ? firecrawlDomainFor([...verified], effort === 'extra_high' ? false : hasNamedRoles) : null;
    if (firecrawlDomain) {
      const seenPages = [...(firecrawlDomain === siteDomain ? pages : []),
        ...confirmedSites.filter((s) => s.domain === firecrawlDomain).flatMap((s) => s.pages)];
      try {
        for (let page = 0; page < (effort === 'extra_high' ? 2 : 1); page++) {
          const team = await firecrawl.readTeam(firecrawlDomain, seenPages, optionalBudget());
          if (team) {
            extraSitePeople.push(...team.people);
            if (ownerSites.has(firecrawlDomain)) trustedOwnerPeople.push(...team.people);
          }
        }
      } catch (error) {
        if (error instanceof DeepFindAuthorisationLost) {
          throw error;
        }
        console.error('deep find: Firecrawl checkpoint failed');
      }
    }
  };
  if (effort === 'custom') await readDeeperPages();
  for (const person of confirmedSites.length > 0 ? peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers) : []) {
    for (const s of confirmedSites) {
      const picked = pickWebsiteFindings(s.pages.map((h) => extractWebsiteFindings(h, s.domain, person.first, person.last)), person.first, person.last);
      const email = picked.email ? cleanEmail(picked.email) : null;
      if (!email || emailOnLead(all(), email)) continue;
      const contact = person.contactId ? all().find((c) => c.id === person.contactId) ?? null : null;
      if (contact) {
        const saved = await saveContact(contact, { email });
        if (saved) { Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++; }
      } else {
        suggestions.push({ name: `${person.first} ${person.last}`.slice(0, 80), field: 'email', value: email, label: `Found on ${s.domain}, check it` });
      }
      break;
    }
  }

  const emails = [...new Set([str(lead.email), ...all().filter(c => !c.dismissed_at).map(c => str(c.email))].filter((e): e is string => !!e))];
  if (effort !== 'custom') {
    // Re-check saved emails: an address alone, catch-all or unavailable verdict is never verified evidence.
    for (const email of emails.slice(0, MAX_VERIFY_PER_LEAD)) {
      if (left() < WORKER_TIMEOUT_MS.verify + 2_000) break;
      const checked = await checkEmail(email);
      if (checked.ok && checked.value.status === 'valid') break;
    }
  }

  // (1c) the email format on each confirmed domain, from addresses we already know there (contacts, the lead's own
  // email, addresses written on the domain's site). Built addresses are checked with our own checker first, then Hunter when it cannot decide and credits allow;
  // otherwise they are only offered as "Guess, unverified" suggestions: never filled in, never in sequences.
  const ownerName = parseLeadPersonName(lead.owner_name);
  const checks = new GuessChecks(MAX_VERIFY_PER_LEAD);
  for (const [email, checked] of checkedEmails) checks.record(email,
    checked.ok ? checked.value.status : null, checked.ok ? checked.value.reason : checked.failure);
  const guessBudget = new GuessBudget(left, () => lookupPeople().length > 0);
  const patterns = new Map<string, ReturnType<typeof inferDomainPattern>>();
  let publicFormatSearchUsed = false;
  const confirmedGuessPeople = new Set<string>();
  // In-flight valid results stop admission; only the result loops mark an address as handled.
  const validCheckPeople = new Set<string>();
  const unverifiedGuesses = new Set<string>();
  const peopleBeforeChecks = lookupPeople();
  const emailDetails = new Map<string, string[]>();
  const detail = (name: string, line: string) => emailDetails.set(name, [...(emailDetails.get(name) ?? []), line]);
  const checkerFailures: Record<WorkerFailure, string> = {
    not_configured: 'The email checker is not set up.', limit_reached: 'The email checker reached its limit.',
    busy: 'The email checker is busy.', unreachable: 'The email checker could not be reached.',
    bad_response: 'The email checker could not return a usable answer.',
    timeout: 'The email checker took too long to answer for this address.',
  };
  let checkerFailure: string | null = workerConfig ? null : checkerFailures.not_configured;
  let verifications = 0;
  const freeCheckedDomains = new Set<string>();
  const runFreeDomainChecks = async (checkDomains: string[]) => {
    for (const domain of checkDomains) freeCheckedDomains.add(domain);
    const knownNames = [
      ...peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, all(), officers).map((p) => ({ first: p.first, last: p.last })),
      ...extraSitePeople.flatMap((p) => { const n = parseLeadPersonName(p.name); return n ? [{ first: n.first, last: n.last }] : []; }),
    ].slice(0, 20);

    for (const d of checkDomains.slice(0, 4)) {
      if (cachedMailProvider(d) === null && left() > 5_000) await lookupMx(d);
      const samples: PatternSample[] = [
        ...all().flatMap((c) => (contactFormatEvidence(c) && emailDomain(str(c.email)) === d ? [{ email: str(c.email)!, first: str(c.first_name), last: str(c.last_name) }] : [])),
        ...(str(lead.email) && emailDomain(str(lead.email)) === d ? [{ email: str(lead.email)!, first: ownerName?.first ?? null, last: ownerName?.last ?? null }] : []),
        ...(siteEmails.get(d) ?? []).map((email) => ({ email, first: null, last: null })),
      ];
      const pattern = inferDomainPattern(d, samples.filter(s => formatEvidence(s.email)), knownNames);
      patterns.set(d, pattern);
      if (pattern) steps.push(patternLine(d, pattern));
      if (['google', 'microsoft'].includes(cachedMailProvider(d) ?? '')) checks.blocked.add(d);
    }
    // Round-robin candidates across people. Both inferred and common formats share the same three slots.
    const guessPeople = lookupPeople().slice(0, 5);
    const jobs: ((timeoutMs: number) => Promise<void>)[] = [];
    for (let rank = 0; rank < 6; rank++) for (const d of checkDomains.slice(0, 4)) for (const person of guessPeople) {
      const guess = rankedEmailCandidates(person.first, person.last, d, patterns.get(d) ?? null)[rank];
      if (!guess) continue;
      jobs.push(async timeoutMs => {
        const name = person.first + ' ' + person.last;
        if (confirmedGuessPeople.has(name) || validCheckPeople.has(name) || checkerFailure || emailOnLead(all(), guess) || !checks.claim(guess)) return;
        const checked = await checkEmail(guess, { timeoutMs });
        checks.record(guess, checked.ok ? checked.value.status : null, checked.ok ? checked.value.reason : checked.failure);
        if (!checked.ok) {
          if (checked.failure !== 'timeout') { checks.stopWorker(); checkerFailure = checkerFailures[checked.failure]; }
          else detail(name, checkerFailures.timeout);
        }
        else if (checked.value.status === 'invalid') invalidGuesses.add(guess);
        else if (checked.value.status === 'valid') validCheckPeople.add(name);
      });
    }
    await guessBudget.run(jobs);
    for (const d of checkDomains.slice(0, 4)) {
      const pattern = patterns.get(d);
      if (!pattern) continue;
      for (const person of guessPeople) {
        const name = `${person.first} ${person.last}`.slice(0, 80);
        if (invalidSavedEmail(findSamePerson(all(), person.first, person.last))) continue;
        if (confirmedGuessPeople.has(name)) continue;
        const guess = patternGuess(pattern, person, d);
        if (!guess || emailOnLead(all(), guess) || suggestions.some((s) => s.value === guess)) continue;
        let verdict: string | null = null;
        let label = guessLabel(pattern, d);
        // Free checker first; Hunter is asked only when it cannot decide and credits remain.
        const checked = checkedEmails.get(guess.toLowerCase()) ?? null;
        if (checked) {
          checks.record(guess, checked.ok ? checked.value.status : null, checked.ok ? checked.value.reason : checked.failure);
          if (!checked.ok && checked.failure !== 'timeout') { checks.stopWorker(); checkerFailure = checkerFailures[checked.failure]; }
        }
        const action = verifyAction(checked && checked.ok ? checked.value.status : null, !!hunterKey && !guessBudget.exhausted && !checks.blocked.has(d) && !checks.catchAll.has(d) && verifications < 3 && left() > 45_000);
        if (action === 'drop') { invalidGuesses.add(guess); continue; }
        if (action === 'accept') {
          confirmedGuessPeople.add(name);
          detail(name, 'An email-format guess was confirmed by our email checker.');
          verdict = 'verified';
          label = 'Built from the email format and confirmed by our email checker, check it';
        } else if (action === 'ask_hunter') {
          const hunterTimeout = guessBudget.timeout(5_000);
          if (hunterTimeout < 1) continue;
          if (await spend.hunter('verify email format')) {
            verifications++;
            const v = await hunterVerifyEmail(guess, hunterKey!, hunterTimeout);
            if (v.ok) {
              verdict = v.verdict;
              if (verdict === 'verified') { confirmedGuessPeople.add(name); label = 'Built from the email format and verified by Hunter, check it'; }
            } else {
              problems.push({ step: 'hunter_verify', target: d, failure: safeFailure(v.failure) });
              if (v.failure === 'usage_exhausted' || v.failure === 'rate_limited') spend.stopHunter();
            }
          }
        }
        if (verdict === 'invalid') { invalidGuesses.add(guess); continue; }
        if (verdict !== 'verified' && checked && checked.ok) label = unconfirmedLabel(checked.value.reason);
        const contact = person.contactId ? all().find((c) => c.id === person.contactId) ?? null : null;
        // When our checker answered (risky/unverifiable) Hunter's "verified" only makes this a labelled suggestion, never a fill.
        const checkerSaidValid = action === 'accept';
        if (verdict === 'verified' && contact && checkerSaidValid) {
          const saved = await saveContact(contact, { email: guess });
          if (saved) { Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++; }
        } else {
          if (verdict !== 'verified') unverifiedGuesses.add(guess);
          suggestions.push({ name, field: 'email', value: guess, label });
        }
      }
    }

    // Common guesses share the inferred-format check budget. Only our checker's valid verdict can fill a blank.
    // A new person always remains a suggestion for human review, even when their guessed address is valid.
    for (const person of lookupPeople().slice(0, 5)) {
      const name = `${person.first} ${person.last}`.slice(0, 80);
      if (confirmedGuessPeople.has(name)) continue;
      for (const d of checkDomains.slice(0, 4)) {
        const candidates = rankedEmailCandidates(person.first, person.last, d, patterns.get(d) ?? null);
        if (candidates.length === 0) { detail(name, 'This name could not be used to build an email address.'); continue; }
        const tried = candidates.filter((email) => checks.attempted.has(email)).length;
        let valid = false;
        for (const guess of candidates) {
          if (emailOnLead(all(), guess) || suggestions.some((s) => s.value.toLowerCase() === guess)) continue;
          const checked = checkedEmails.get(guess.toLowerCase());
          if (!checked) continue;
          checks.record(guess, checked.ok ? checked.value.status : null, checked.ok ? checked.value.reason : checked.failure);
          if (!checked.ok) {
            if (checked.failure === 'timeout') { detail(name, checkerFailures.timeout); continue; }
            checks.stopWorker(); checkerFailure = checkerFailures[checked.failure]; break;
          }
          if (checked.value.status === 'invalid') invalidGuesses.add(guess);
          if (verifyAction(checked.value.status, false) !== 'accept') continue;
          if (invalidSavedEmail(findSamePerson(all(), person.first, person.last))) break;
          valid = checks.shouldStopPerson(checked.value.status);
          if (valid) confirmedGuessPeople.add(name);
          const contact = person.contactId ? all().find((c) => c.id === person.contactId) : null;
          if (contact) {
            const saved = await saveContact(contact, { email: guess });
            if (saved) {
              Object.assign(contact, saved); touched.add(contact.id); stats.officerEmails++;
              steps.push(`${name}: ${COMMON_GUESS_LABEL}.`);
            } else detail(name, 'A confirmed guess could not be saved; refresh and try again.');
          } else suggestions.push({ name, field: 'email', value: guess, label: COMMON_GUESS_LABEL });
          break;
        }
        if (checks.timedOut.has(d)) detail(name, 'This mail server answers too slowly to check, so these are best guesses.');
        if (checks.catchAll.has(d)) {
          detail(name, 'The mail server accepts any address, so guesses cannot be confirmed.');
        } else if (tried > 0) detail(name, `Tried ${tried} common format${tried === 1 ? '' : 's'} on ${d} (${valid ? 'one confirmed for review' : 'none confirmed'}).`);
        else if (!checkerFailure && !checks.canCheck(candidates[0]!)) detail(name, 'The email check limit for this run or domain was reached.');
        if (valid) break;
      }
    }

    if (guessBudget.exhausted && !steps.includes('Email guess checks reached the 36 second limit for this lead. Remaining time was kept for people lookups.')) steps.push('Email guess checks reached the 36 second limit for this lead. Remaining time was kept for people lookups.');
  };
  const discoverPublicFormat = async () => {
      if ((effort === 'high' || effort === 'extra_high') && geminiKey && !publicFormatSearchUsed && ![...checkedEmails.values()].some(c => c.ok && c.value.status === 'valid')) {
        const domain = [...verified][0];
        if (domain && !patterns.get(domain) && left() > 40_000 && await spend.ai('public email format')) {
          publicFormatSearchUsed = true;
          await checkpoint();
          const samples = await webSearchDomainFormat(domain, geminiKey, Math.min(8_000, left() - 30_000));
          const names = lookupPeople().map(p => ({ first: p.first, last: p.last }));
          const pattern = inferDomainPattern(domain, samples, names);
          if (pattern) { patterns.set(domain, pattern); steps.push(patternLine(domain, pattern)); }
        }
      }
  };
  await runFreeDomainChecks([...verified].slice(0, 4));

  if (effort !== 'custom') {
    const decision = deepPhaseDecision(effort, {
      verifiedEmail: emails.some(email => { const c = checkedEmails.get(email.toLowerCase()); return c?.ok && c.value.status === 'valid'; }),
      namedPerson: (!!parseLeadPersonName(lead.owner_name) && !ownerSuppressed(String(lead.owner_name))) || all().some(c => (isOwnerRole(c.title) || (['hunter', 'apollo', 'web'].includes(str(c.source) ?? '') && !!str(c.title))) && c.kind !== 'general' && !c.dismissed_at && c.name_obfuscated !== true && !!parseLeadPersonName(`${str(c.first_name) ?? ''} ${str(c.last_name) ?? ''}`))
        || officers.some(o => !!parseLeadPersonName(`${o.first_name ?? ''} ${o.last_name ?? ''}`))
        || [...trustedOwnerPeople, ...extraSitePeople, ...pages.flatMap(extractTeamMembers), ...webPeople].some(p => !!str(p.role) && !!parseLeadPersonName(p.name) && !ownerSuppressed(p.name)),
      confirmedWebsite: discovery.domains.some(d => d.domain === domainFromWebsite(str(lead.website)) && !d.needs_check && d.sources.includes('site_confirms')),
    });
    steps.push(decision.line);
    deepEnabled = decision.run;
    spend.enabled = deepEnabled;
    if (deepEnabled) {
      hunterKey = configured.hunterKey; geminiKey = configured.geminiKey;
      if (effort === 'extra_high') ocKey = configured.ocKey;
      if (effort === 'high' || effort === 'extra_high') { apolloKey = configured.apolloKey; placesKey = configured.placesKey; }
      if (effort === 'extra_high' && ocKey && !str(lead.owner_name) && !officers.length && left() > 30_000) {
        await checkpoint();
        const name = await lookupOpenCorporatesOfficer(str(lead.business_name) ?? '', ocKey);
        if (name) suggestions.push({ name, field: 'owner_name', value: name, label: 'OpenCorporates officer match; check company and ownership before adding.' });
      }
      await discoverPublicFormat();
      await checkHunterAllowance();
      await fillPlaces();
      // The free discovery has finished; only now may missing details use provider credits.
      const deeper = await discoverLeadDomains(service, {
        id: lead.id, org_id: lead.org_id, business_name: str(lead.business_name), website: str(lead.website), email: str(lead.email),
        city: str(lead.city), postcode: str(lead.postcode), email_domains: lead.email_domains, blocked_domains: lead.blocked_domains,
      }, {
        registeredName: registry.name, registeredAddress: registry.address, people: knownPeople, websiteSuspect: suspicion.suspect,
        extraKnown: contactDomains.map(domain => ({ domain, source: 'contact_email' as const })),
        keys: { hunterKey, geminiKey, apolloKey }, allow: { hunter: true, site: pages.length > 0, web: true, apollo: !!apolloKey },
        pages, budgetMs: Math.min(30_000, Math.max(0, left() - 30_000)), hunterCap: Math.max(0, discoveryCap - (spend.used.hunter['company domains'] ?? 0)),
        guard: { hunter: () => spend.hunter('company domains'), ai: () => spend.ai('web search') },
      });
      for (const d of deeper.domains) {
        const existing = discovery.domains.find(c => c.domain === d.domain);
        if (!existing) discovery.domains.push(d);
        else if (!d.needs_check) Object.assign(existing, d);
        if (!domains.includes(d.domain)) domains.push(d.domain);
        if (!d.needs_check) verified.add(d.domain);
      }
      webPeople.push(...deeper.people);
      for (const site of deeper.sitePages.filter(s => verified.has(s.domain))) {
        confirmedSites.push(site);
        extraSitePeople.push(...site.pages.flatMap(extractTeamMembers));
        const own = deeper.domains.some(d => d.domain === site.domain && !d.needs_check && d.sources.includes('site_confirms'));
        if (own) { ownerSites.add(site.domain); trustedOwnerPeople.push(...site.pages.flatMap(extractTeamMembers)); }
      }
      discovery.sitePages.push(...deeper.sitePages);
      steps.push(...deeper.notes.slice(0, 6)); problems.push(...deeper.problems);
      if ((effort === 'high' || effort === 'extra_high') && registry.how === 'ambiguous' && geminiKey && left() > 18_000 && await spend.ai('company registry proof')) {
        await checkpoint();
        const webNumbers = await registryWebNumbers(str(lead.business_name) ?? '', geminiKey, Math.min(10_000, left() - 5_000));
        registry = await resolveRegistry(service, lead, chKey, registryPeople, { pages: registryPages, website: usableSite ? str(lead.website) : null, cached: registry.allCandidates ?? registry.candidates, cachedPeople: registry.proofPeople, priorEvidence: registry.evidence, webNumbers, left, checkpoint, applyNumber: number => applyLead('company_number', number) });
        registryEvidence = registry.evidence ?? {};
        steps.push(registryStep(registry));
        if (registry.number) await addRegistryOfficers();
      }
      // Newly confirmed domains share the original time reserves, checker budget and Hunter caps.
      const newDomains = [...verified].filter(d => !freeCheckedDomains.has(d)).slice(0, Math.max(0, 4 - freeCheckedDomains.size));
      for (const domain of newDomains) {
        const supplied = deeper.sitePages.find(s => s.domain === domain)?.pages ?? [];
        const pageBudget = Math.min(8_000, optionalBudget() - 30_000);
        if (!supplied.length && pageBudget >= 2_000) await checkpoint();
        const newPages = supplied.length ? supplied : pageBudget >= 2_000 ? await readCompanyPages('https://' + domain, pageBudget) : [];
        if (newPages.length) {
          siteEmails.set(domain, domainEmailsOnPages(newPages, domain));
          if (!confirmedSites.some(s => s.domain === domain)) confirmedSites.push({ domain, pages: newPages });
          extraSitePeople.push(...newPages.flatMap(extractTeamMembers));
          for (const email of siteEmails.get(domain) ?? []) {
            if (!emailOnLead(all(), email) && !suggestions.some(s => s.value === email)) suggestions.push({ name: 'Company contact', field: 'email', value: email, label: 'Found on ' + domain + ', check it' });
          }
        }
      }
      await runFreeDomainChecks(newDomains);
      await discoverPublicFormat();
      await readDeeperPages();
    }
  } else steps.push(deepPhaseDecision('custom', { verifiedEmail: false, namedPerson: false, confirmedWebsite: false }).line);

  // (2) Hunter's company list on every domain: every named person with a role
  const lists = new Map<string, { emails: unknown[]; pattern: string | null }>();
  for (const d of domains) {
    if (!hunterKey || left() < 20_000 || [...checkedEmails.values()].some(c => c.ok && c.value.status === 'valid')) break;
    if (!await spend.hunter('company lists')) break;
    // limit 10: Hunter bills about 1 credit per 10 addresses, so one reserved credit covers this call.
    const res = await hunterDomainList(d, hunterKey, 6_000, 10);
    if (res.ok) lists.set(d, { emails: res.emails, pattern: res.pattern });
    else {
      problems.push({ step: 'hunter_list', target: d, failure: safeFailure(res.failure) });
      if (res.failure === 'usage_exhausted' || res.failure === 'rate_limited') { spend.stopHunter(); break; }
    }
  }
  // Reuse paid domain lists for the old Fill-details company-email fallback; no second Hunter call.
  for (const [domain, list] of lists) if (verified.has(domain)) {
    const named = hunterPeople(list.emails, domain, cleanEmail, cleanLinkedinProfile);
    const personal = new Set(named.map(p => p.email.toLowerCase()));
    for (const person of named) suggestions.push({ name: person.first_name + ' ' + person.last_name, field: 'email', value: person.email, label: 'Hunter named-person address; review before adding.' });
    for (const raw of list.emails.slice(0, 10)) {
      const email = raw && typeof raw === 'object' ? cleanEmail((raw as Record<string, unknown>).value) : null;
      if (email && !personal.has(email.toLowerCase()) && emailDomain(email) === domain && !emailOnLead(all(), email)) suggestions.push({ name: 'Company contact', field: 'email', value: email, label: 'Hunter company-list address; review before adding.' });
    }
  }
  const listed = [...lists.entries()].flatMap(([d, l]) => hunterPeople(l.emails, d, cleanEmail, cleanLinkedinProfile).map((p) => ({ ...p, domain: d })));
  const found = rankPeople(listed.filter((p) => verified.has(p.domain)), webPeople).slice(0, MAX_HUNTER_PEOPLE_PER_LEAD);
  // People on a domain that is not corroborated are never stored: they are listed for the user to check.
  const unverifiedPeople = visibleSuggestions(rankPeople(listed.filter((p) => !verified.has(p.domain)), webPeople)
    .filter((p) => !emailOnLead(rows, p.email)).slice(0, 10)
    .map((p) => ({ name: `${p.first_name} ${p.last_name}`.slice(0, 80), role: p.title.slice(0, 60), email: p.email, domain: p.domain })), lead, all());
  stats.unverifiedPeople = unverifiedPeople.length;
  const toInsert: Record<string, unknown>[] = [];
  for (const p of found) {
    if (emailOnLead([...rows, ...created], p.email) || toInsert.some((r) => r.email === p.email)) continue;
    const same = findSamePerson([...rows, ...created], p.first_name, p.last_name);
    if (!same && samePersonMatches(all(), p.first_name, p.last_name).length) {
      const name = `${p.first_name} ${p.last_name}`;
      suggestions.push({ name, field: 'email', value: p.email, label: 'Hunter found several possible people; review the full name before adding.' });
      if (p.linkedin_url) suggestions.push({ name, field: 'linkedin_url', value: p.linkedin_url, label: 'Person match is ambiguous; review before adding.' });
      continue;
    }
    if (same) {
      // The same person is already on the lead (for example a registry officer): fill their blanks, never add twice.
      if (!same.dismissed_at && !str(same.email)) {
        const saved = await saveContact(same, { email: p.email, title: p.title, ...(p.linkedin_url ? { linkedin_url: p.linkedin_url } : {}) });
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
  if (toInsert.length) await checkpoint();
  const insertedHunter = await insertContacts(service, await prepareContacts(toInsert.map((r) => ({ ...r, email: null, email_revealed: false, linkedin_url: null }))));
  created.push(...insertedHunter);
  for (const c of insertedHunter) {
    const proposal = toInsert.find((p) => p.first_name === c.first_name && p.last_name === c.last_name);
    if (proposal?.email) await saveContact(c, { email: String(proposal.email), ...(proposal.linkedin_url ? { linkedin_url: String(proposal.linkedin_url) } : {}) });
  }
  for (const c of insertedHunter) touched.add(c.id);
  stats.hunterPeople = insertedHunter.length;

  // (3) everyone to look up (contacts without an email, officers, names on the lead) on CONFIRMED domains only
  // Keep the existing wide-lookup trust boundary: site/web-only names get guesses for review above,
  // but do not become Hunter contacts merely because the optional team reader found them.
  const people = peopleToLookUp({ owner_name: lead.owner_name, additional_owners: lead.additional_owners }, lookupContacts(), officers).filter(p => !ownerSuppressed(p.first + ' ' + p.last));
  const verifiedDomains = domains.filter((d) => verified.has(d)).slice(0, 4);
  // Share the exact same grounded search with wide email lookups: never search twice for one person in a run.
  const personKey = (first: string, last: string) => `${first} ${last}`.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const searches = new Map<string, Promise<LookupResult>>();
  const owner = parseLeadPersonName(lead.owner_name);
  const ownerKey = owner ? personKey(owner.first, owner.last) : null;
  const roles = [...webPeople, ...pages.flatMap((html) => extractTeamMembers(html)), ...extraSitePeople];
  const ownerLike = (p: WebSearchPerson) => isOwnerRole(p.title) || personKey(p.first, p.last) === ownerKey
    || isOwnerRole(roleForPerson(`${p.first} ${p.last}`, roles, all()));
  const searchRaw = (p: WebSearchPerson, timeout: number): Promise<LookupResult> => {
    const key = personKey(p.first, p.last);
    const cached = searches.get(key);
    if (cached) return cached;
    const result = (async (): Promise<LookupResult> => {
      if (!geminiKey || !await spend.ai('people')) return { ok: false, failure: 429 };
      return webSearchForPerson({ ...p, includeEvidence: effort === 'extra_high' || ownerLike(p) }, geminiKey, Math.min(timeout, Math.max(1, left() - 2_000)));
    })();
    searches.set(key, result);
    return result;
  };
  const peopleOut = await lookUpPeople({
    service, run, lead: { id: lead.id, website: str(lead.website), business_name: str(lead.business_name) }, people,
    contacts: all, emailFormatEvidence: contactFormatEvidence, domains: verifiedDomains, website: usableSite ? str(lead.website) : null,
    websiteDirectory: !!siteDomain && isDirectoryDomain(siteDomain), lists, keys: { hunterKey, geminiKey },
    spend: { hunter: () => spend.hunter('people'), ai: () => spend.ai('people'), stopHunter: () => spend.stopHunter() }, left,
    saveContact, checkpoint, prepareContact,
    searchPerson: async (p, timeout) => {
      const result = await searchRaw(p, timeout);
      // Owner LinkedIn matches are applied below only after the evidence check, with their own CAS and Undo record.
      return result.ok && ownerLike(p) ? { ...result, found: { ...result.found, linkedin_url: null } } : result;
    },
  });
  for (const person of people) {
    const contact = person.contactId ? all().find(c => c.id === person.contactId) : null;
    if (!invalidSavedEmail(contact)) continue;
    const name = `${person.first} ${person.last}`.slice(0, 80);
    const result = peopleOut.results.find(r => r.name === name);
    if (result) { result.email_found = false; result.reason = 'Saved address does not exist.'; }
    else peopleOut.results.push({ name, role: person.title, source: person.source, email_found: false, reason: 'Saved address does not exist.' });
  }
  created.push(...peopleOut.created);
  for (const c of peopleOut.touched) touched.add(c.id);
  stats.officerEmails += peopleOut.emailsFound;
  for (const s of peopleOut.suggestions) {
    if (suggestions.some((x) => x.field === s.field && x.value.toLowerCase() === s.value.toLowerCase())) continue;
    suggestions.push(s);
  }
  problems.push(...peopleOut.problems);
  // Rank remaining guesses only for confirmed domains and people still missing an address.
  for (const person of lookupPeople()) {
    const savedPerson = findSamePerson(all(), person.first, person.last);
    if (savedPerson?.email && !invalidSavedEmail(savedPerson)) continue;
    const name = person.first + ' ' + person.last;
    const domain = [...verified][0];
    if (!domain) continue;
    const replacements = invalidSavedEmail(savedPerson) ? suggestions.filter(s => displayPersonKey(s.name) === displayPersonKey(name) && s.field === 'email').map(s => s.value) : [];
    const candidates = [...new Set([...replacements, ...rankedEmailCandidates(person.first, person.last, domain, patterns.get(domain) ?? null)].map(email => email.toLowerCase()))]
      .filter(email => {
        const checked = checkedEmails.get(email);
        return !invalidGuesses.has(email) && !(checked?.ok && checked.value.status === 'invalid') && !emailOnLead(all(), email);
      });
    if (!candidates.length || confirmedGuessPeople.has(name)) continue;
    // Replace old unverified format guesses; never replace found or checker-valid evidence.
    for (let i = suggestions.length - 1; i >= 0; i--) {
      const s = suggestions[i];
      if (displayPersonKey(s.name) === displayPersonKey(name) && s.field === 'email' && (unverifiedGuesses.has(s.value) || invalidSavedEmail(savedPerson))) suggestions.splice(i, 1);
    }
    if (suggestions.some(s => displayPersonKey(s.name) === displayPersonKey(name) && s.field === 'email')) continue;
    const provider = cachedMailProvider(domain) ?? 'unknown';
    suggestions.push(...unverifiedEmailSuggestions(name, candidates.slice(0, 3), provider).map(s => invalidSavedEmail(savedPerson)
      ? { ...s, replaces_saved_email: { contact_id: savedPerson!.id, email: str(savedPerson!.email)! }, label: s.label + ' Replaces the saved address that does not exist.' } : s));
    detail(name, providerGuessLine(domain, provider));
  }
  const checkerNotConfigured = checkerFailure === checkerFailures.not_configured;
  if (checkerNotConfigured && peopleBeforeChecks.length > 0) {
    steps.push('The email checker is not set up, so email formats were not tried.');
  }
  for (const person of peopleBeforeChecks) {
    const savedPerson = findSamePerson(all(), person.first, person.last);
    if (savedPerson?.email && !invalidSavedEmail(savedPerson)) continue;
    const name = `${person.first} ${person.last}`.slice(0, 80);
    const lines = emailDetails.get(name) ?? [];
    if (checkerFailure && !checkerNotConfigured) lines.push(checkerFailure);
    const lookup = peopleOut.results?.find((r) => r.name === name);
    if (lookup?.reason) lines.push(lookup.reason);
    if (hunterAccountInfo && hunterAccountEmpty(hunterAccountInfo)) lines.push('Hunter is used up this month.');
    else if (!hunterKey) lines.push('No Hunter key is set.');
    else if (spend.hunterHit || spend.hunterStopped) lines.push('Hunter is unavailable for the rest of this run.');
    if (verified.size === 0) lines.push('No company domain is confirmed.');
    steps.push(personEmailLine(name, lines));
  }
  if (people.length > 0) steps.push(`Looked up ${people.length} known ${people.length === 1 ? 'person' : 'people'}: ${peopleOut.emailsFound} email${peopleOut.emailsFound === 1 ? '' : 's'} found.`);

  // (4) team pages and (5) the web search: names only, never stored unless already a contact
  const sitePeople: SitePerson[] = [];
  for (const p of [...pages.flatMap((html) => extractTeamMembers(html)), ...extraSitePeople]) {
    sitePeople.push(p);
  }
  const namedOnSite = visibleSuggestions(fullestPeople(sitePeople, p => p.name).filter((p) => !namedPersonIsStored(p.name, all())), lead, all()).slice(0, 10);
  const namedByWeb = visibleSuggestions(fullestPeople(webPeople, p => p.name).filter((p) => !namedPersonIsStored(p.name, all())), lead, all()).slice(0, 10)
    .map((p) => ({ ...p, also_on_site: namedOnSite.some((s) => s.name.toLowerCase() === p.name.toLowerCase()) }));
  // Only the company's own pages (including the BYO team reader) can establish an owner role.
  for (const person of trustedOwnerPeople.filter((p) => isOwnerRole(p.role))) {
    const parsed = parseLeadPersonName(person.name);
    if (!parsed || ownerSuppressed(person.name)) continue;
    const contact = exactContact(parsed.first, parsed.last);
    if (!contact || contact.dismissed_at || (String(contact.first_name ?? '') + ' ' + String(contact.last_name ?? '')).trim().toLowerCase().replace(/\s+/g, ' ') !== person.name.trim().toLowerCase().replace(/\s+/g, ' ')) {
      suggestions.push({ name: person.name, field: 'owner_name', value: person.name, label: 'Own-site owner role; review the full name before adding.' });
      continue;
    }
    await applyLead('owner_name', person.name);
    if (contact) await applyDeepFindBlank(service, scope, 'decision_maker_candidates', contact, 'title', person.role!, autoApplied, checkpoint);
  }
  // Apollo's search is free and keeps its obfuscated names. No paid person/phone reveal is requested.
  const apolloDomain = [...verified][0];
  if (deepEnabled && apolloKey && apolloDomain && left() > 15_000) {
    await checkpoint();
    const candidates = await searchApolloDecisionMakers(apolloDomain, apolloKey, 3);
    await checkpoint();
    const added = await insertContacts(service, await prepareContacts(candidates.map((p) => ({
      lead_id: lead.id, source: 'apollo', apollo_person_id: p.apolloPersonId,
      first_name: p.firstName, last_name: p.lastNameObfuscated, title: p.title,
      name_obfuscated: true, email_revealed: false, include_in_sequences: false,
      linkedin_url: null, created_by: run.created_by,
    }))));
    created.push(...added);
    for (const p of candidates) {
      const url = cleanLinkedinProfile(p.linkedinUrl);
      if (url && p.firstName && p.lastNameObfuscated) suggestions.push({ name: `${p.firstName} ${p.lastNameObfuscated}`, field: 'linkedin_url', value: url, label: 'Apollo profile for a partly hidden name; check the person and company before adding.' });
    }
    apolloPeople = added.length;
    steps.push(`Apollo decision-maker search: ${added.length} new contacts. Names may be hidden until reviewed and revealed.`);
    if (!str(lead.phone) && !placesSuppliedPhone && left() > 15_000) {
      await checkpoint();
      const allowed = await checkRateLimit(service, 'apollo-company-phone:' + run.org_id, 100, 1440, true);
      if (!allowed) steps.push("Apollo company phone lookups reached today's limit for this organisation.");
      const phone = allowed ? await lookupApolloPhone('https://' + apolloDomain, apolloKey) : null;
      if (phone && isReviewPhone(phone)) suggestions.push({ name: 'Company contact', field: 'phone', value: phone, label: 'Apollo company phone; review before adding.' });
    }
  }
  // Owner-like contacts are searched even when an email is already saved. Names without a contact remain reviewable.
  const linkedinPeople: WebSearchPerson[] = [];
  const addLinkedinPerson = (p: WebSearchPerson) => {
    if (ownerSuppressed(p.first + ' ' + p.last)) return;
    if (!p.first || !p.last || (effort !== 'extra_high' && !ownerLike(p)) || linkedinPeople.some((x) => personKey(x.first, x.last) === personKey(p.first, p.last))) return;
    const contact = findSamePerson(all(), p.first, p.last);
    if (contact?.dismissed_at || str(contact?.linkedin_url)) return;
    linkedinPeople.push(p);
  };
  for (const c of all()) if (c.kind !== 'general' && !c.dismissed_at && c.name_obfuscated !== true) addLinkedinPerson({ first: str(c.first_name) ?? '', last: str(c.last_name) ?? '', title: str(c.title), company: str(lead.business_name), domains: verifiedDomains });
  if (owner) addLinkedinPerson({ ...owner, company: str(lead.business_name), domains: verifiedDomains });
  for (const p of roles) {
    const name = parseLeadPersonName(p.name);
    if (name) addLinkedinPerson({ ...name, title: p.role, company: str(lead.business_name), domains: verifiedDomains });
  }
  if (geminiKey && (effort === 'custom' || effort === 'high' || effort === 'extra_high')) for (const p of linkedinPeople) {
    const name = `${p.first} ${p.last}`;
    if (!searches.has(personKey(p.first, p.last)) && left() < 7_000) { steps.push(`LinkedIn search for ${name} skipped: not enough time left. Try Deep find again.`); continue; }
    const result = await searchRaw(p, 8_000);
    if (!result.ok) { steps.push(`LinkedIn search for ${name} gave no answer${spend.aiHit ? ': the AI-call limit was reached' : ''}.`); continue; }
    const match = linkedinMatch(result.found.linkedin_url, result.evidence, name, [str(lead.business_name) ?? '', registry.name ?? ''].filter(Boolean), verifiedDomains);
    if (!match) { steps.push(`No supported LinkedIn profile found for ${name}.`); continue; }
    const contact = findSamePerson(all(), p.first, p.last);
    if (match.high && contact && !contact.dismissed_at && !str(contact.linkedin_url)) {
      const saved = await applyDeepFindBlank(service, scope, 'decision_maker_candidates', contact, 'linkedin_url', match.url, autoApplied, checkpoint);
      if (saved) touched.add(contact.id);
    } else suggestions.push({ name, field: 'linkedin_url', value: match.url, label: match.evidence });
  }
  stats.namedOnSite = namedOnSite.length;
  stats.namedByWeb = namedByWeb.length;
  stats.hunterCapHit = spend.hunterHit;
  stats.aiCapHit = spend.aiHit;
  // One plain line per search that gave no answer (replaces the old "N searches did not work" count), then the credits.
  steps.push(...worker.lines());
  steps.push(...firecrawl.lines());
  steps.push(...problemLines(problems));
  steps.push(creditLine({ ...spend.used, firecrawl: firecrawl.pagesUsed() }));

  // LinkedIn auto-capture, like findDecisionMakers, for contacts this run created or filled
  for (const c of all()) {
    if (!touched.has(c.id) || !str(c.linkedin_url) || c.dismissed_at) continue;
    const fullName = `${str(c.first_name) ?? ''} ${str(c.last_name) ?? ''}`.trim() || 'Unknown';
    await checkpoint();
    const { error } = await service.from('linkedin_contacts').upsert({
      org_id: run.org_id, lead_id: lead.id, decision_maker_candidate_id: c.id, full_name: fullName,
      linkedin_url: c.linkedin_url, context_signal: null, created_by: run.created_by,
    }, { onConflict: 'decision_maker_candidate_id', ignoreDuplicates: true });
    if (error) console.error('deep find: linkedin capture failed');
  }

  const finalSuggestions = reviewableSuggestions().slice(0, 25);
  steps.push(...dismissedStepLines());
  return {
    status: 'done',
    reason: (apolloPeople ? `Apollo added ${apolloPeople} decision-maker contacts. ` : '') + (suspicion.suspect ? "The lead's website may belong to another company, so it was not used. " : '') + deepFindSummary(stats),
    people_found: stats.hunterPeople + stats.officersAdded + apolloPeople,
    domains: {
      ...metadata,
      dismissed_people: dismissedPeople,
      registry_evidence: registryEvidence,
      auto_applied: autoApplied.slice(0, 100),
      domains: discovery.domains,
      named_by_web: namedByWeb,
      named_on_site: namedOnSite,
      suggestions: finalSuggestions,
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
  } catch (error) {
    if (!(error instanceof DeepFindAuthorisationLost)) console.error('deep find: lead processing stopped', error instanceof Error && ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError'].includes(error.name) ? error.name : 'UnknownError', 'Unexpected failure while processing a lead; provider payload omitted.');
    const finalSuggestions = reviewableSuggestions().slice(0, 25);
    steps.push(...dismissedStepLines());
    return { status: error instanceof DeepFindAuthorisationLost ? 'skipped' : 'failed',
      reason: error instanceof DeepFindAuthorisationLost ? error.message : 'Deep find could not finish. Saved changes are listed below with Undo.',
      people_found: created.length, domains: { ...metadata, dismissed_people: dismissedPeople, registry_evidence: registryEvidence, auto_applied: autoApplied.slice(0, 100), suggestions: finalSuggestions, steps } };
  }
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
  for (const r of (running ?? []) as { id: string; claimed_at: string | null; attempts: number; domains?: Record<string, unknown> }[]) {
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
    const { data: runData } = await service.from('deep_find_runs').select('id, org_id, created_by, status, credit_cap_hunter, lead_count').eq('id', row.run_id).maybeSingle();
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
    try { out = await processDeepFindLead(service, run, row); } catch { console.error('deep find: claimed lead processing failed'); out = { status: 'failed', reason: 'Something went wrong while searching this lead.' }; }
    const effort = effortPolicy(row.domains);
    const label = effort === 'custom' ? 'Custom' : EFFORT_LEVELS[effort].label;
    const freshSteps = row.domains?.start_fresh === true && Array.isArray(row.domains.steps)
      ? row.domains.steps.filter((line): line is string => typeof line === 'string' && line.startsWith('Start fresh:')) : [];
    const resultSteps = [...new Set([...freshSteps, ...(Array.isArray(out.domains?.steps) ? out.domains.steps as string[] : [])])];
    if (!resultSteps.some(line => line.startsWith(`${label} effort:`))) resultSteps.push(`${label} effort: stopped before the free phase finished; deeper steps were skipped. ${out.reason}`);
    await updateRow(service, row.id, {
      status: out.status, reason: out.reason.slice(0, 1000), people_found: out.people_found ?? 0,
      domains: { ...row.domains, ...out.domains, effort, steps: resultSteps }, finished_at: nowIso(),
    });
    await completeIfDone(service, run.id);
    processed++;
  }
  return processed;
}
