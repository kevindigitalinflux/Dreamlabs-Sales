// supabase/functions/_shared/deepFind.ts
// Deep find engine: claims queued leads, discovers the company's domains and people, stores people as contacts that are
// NOT in sequences, and writes a plain-English summary per lead. Never emails anyone and never touches sequences.
// Runs with the service client, so every org boundary is re-checked here. Keys only go to providers in headers.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveOrgApiKey } from './orgApiKeys.ts';
import { checkRateLimit } from './rateLimit.ts';
import { fetchActiveOfficers, findRegisteredCompany } from './companiesHouse.ts';
import { discoverLeadDomains } from './domainDiscoveryLookup.ts';
import { DOMAIN_CHECKS } from './domainChecks.ts';
import {
  hunterDomainList, hunterFindEmail, hunterVerifyEmail, readCompanyPages, scanWebsiteForPerson, webSearchForPerson,
} from './knownPersonLookup.ts';
import { cleanEmail, cleanLinkedinProfile, emailDomain } from './knownPersonWide.ts';
import { domainFromWebsite, isDirectoryDomain, mergeFoundIntoPerson, type FoundFields } from './knownPerson.ts';
import { runWideLookup, type KnownAddress } from './knownPersonWideRun.ts';
import { rankPeople } from './peopleRanking.ts';
import type { WebPerson } from './domainDiscovery.ts';
import {
  MAX_HUNTER_PEOPLE_PER_LEAD, MAX_OFFICER_LOOKUPS, deepFindSummary, emailOnLead, extractTeamMembers, findSamePerson,
  hunterPeople, namedPersonIsStored, stuckAction, type ExistingContact, type LeadStats, type SitePerson,
} from './deepFindRules.ts';

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

/** Spends run credits through the atomic deep_find_reserve RPC (the no-overspend guard). */
class Spend {
  hunterHit = false;
  aiHit = false;
  constructor(private service: SupabaseClient, private runId: string) {}
  private async reserve(hunter: number, ai: number): Promise<boolean> {
    const { data, error } = await this.service.rpc('deep_find_reserve', { run_id: this.runId, hunter, ai });
    return !error && data === true;
  }
  async hunter(): Promise<boolean> {
    if (this.hunterHit) return false;
    const ok = await this.reserve(1, 0);
    if (!ok) this.hunterHit = true;
    return ok;
  }
  async ai(): Promise<boolean> {
    if (this.aiHit) return false;
    const ok = await this.reserve(0, 1);
    if (!ok) this.aiHit = true;
    return ok;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/** The lead's registered company: from the raw lead it was scraped from, else a Companies House name + postcode match. */
async function registeredCompany(service: SupabaseClient, lead: Record<string, unknown>, chKey: string | null): Promise<{ number: string | null; name: string | null }> {
  const rawId = str(lead.raw_lead_id);
  if (rawId) {
    const { data } = await service.from('raw_leads').select('source, source_id, raw_data').eq('id', rawId).maybeSingle();
    const raw = data as { source?: unknown; source_id?: unknown; raw_data?: unknown } | null;
    if (raw?.source === 'companies_house' && typeof raw.source_id === 'string' && /^[A-Z0-9]{6,10}$/i.test(raw.source_id)) {
      const company = (raw.raw_data as { company?: { title?: unknown } } | null)?.company;
      return { number: raw.source_id, name: typeof company?.title === 'string' ? company.title.slice(0, 200) : null };
    }
  }
  const name = str(lead.business_name);
  if (chKey && name && str(lead.postcode)) {
    const found = await findRegisteredCompany(name, str(lead.postcode), chKey);
    if (found) return { number: found.company_number, name: found.title };
  }
  return { number: null, name: null };
}

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
  if (!await checkRateLimit(service, `deep-find:${run.org_id}:${lead.id}`, 3, 24 * 60)) {
    return { status: 'skipped', reason: 'Deep find already ran 3 times on this lead today. Try again tomorrow.' };
  }
  if (!await checkRateLimit(service, `deep-find:${run.org_id}`, 200, 24 * 60)) {
    return { status: 'skipped', reason: 'This organisation reached its daily Deep find limit. Try again tomorrow.' };
  }

  const [hunterKey, geminiKey, chKey] = await Promise.all([
    resolveOrgApiKey(service, run.org_id, 'hunter'),
    resolveOrgApiKey(service, run.org_id, 'gemini'),
    resolveOrgApiKey(service, run.org_id, 'companies_house'),
  ]);
  const spend = new Spend(service, run.id);
  const { data: contactData, error: contactErr } = await service.from('decision_maker_candidates').select('*').eq('lead_id', lead.id);
  if (contactErr) return { status: 'failed', reason: 'Could not read this lead\'s contacts.' };
  const rows = (contactData ?? []) as Contact[];
  const created: Contact[] = [];
  const stats: LeadStats = {
    hunterPeople: 0, officersAdded: 0, officerEmails: 0, domainsShown: [], domainsToCheck: 0, namedByWeb: 0, namedOnSite: 0,
    hunterCapHit: false, aiCapHit: false, noHunterKey: !hunterKey, noWebsite: false, failures: 0,
  };
  const suggestions: { name: string; field: string; value: string; label: string }[] = [];

  // (0) the registered company and the website pages, read once
  const registry = await registeredCompany(service, lead, chKey);
  const siteDomain = domainFromWebsite(str(lead.website));
  const usableSite = !!siteDomain && DOMAIN_CHECKS.usable(siteDomain);
  stats.noWebsite = !usableSite;
  const pages = usableSite && left() > 30_000 ? await readCompanyPages(str(lead.website)!, 12_000) : [];

  // (1) the company's domains
  const contactDomains = rows.map((r) => emailDomain(str(r.email))).filter((d): d is string => !!d);
  const discovery = await discoverLeadDomains(service, {
    id: lead.id, org_id: lead.org_id, business_name: str(lead.business_name), website: str(lead.website), email: str(lead.email),
    city: str(lead.city), postcode: str(lead.postcode), email_domains: lead.email_domains,
  }, {
    registeredName: registry.name,
    extraKnown: contactDomains.map((domain) => ({ domain, source: 'contact_email' as const })),
    keys: { hunterKey, geminiKey }, allow: { hunter: true, site: pages.length > 0, web: true },
    budgetMs: Math.min(25_000, Math.max(0, left() - 30_000)), pages,
    guard: { hunter: () => spend.hunter(), ai: () => spend.ai() },
  });
  stats.failures += discovery.failures.filter((f) => !f.endsWith('cap_reached')).length;
  const domains = discovery.domains.map((d) => d.domain);
  stats.domainsShown = discovery.domains.filter((d) => !d.needs_check && d.domain !== siteDomain).map((d) => d.domain);
  stats.domainsToCheck = discovery.domains.filter((d) => d.needs_check).length;
  const webPeople: WebPerson[] = discovery.people;

  // (2) Hunter's company list on every domain: every named person with a role
  const lists = new Map<string, { emails: unknown[]; pattern: string | null }>();
  for (const d of domains) {
    if (!hunterKey || left() < 20_000) break;
    if (!await spend.hunter()) break;
    const res = await hunterDomainList(d, hunterKey, 6_000);
    if (res.ok) lists.set(d, { emails: res.emails, pattern: res.pattern }); else stats.failures++;
  }
  const found = rankPeople([...lists.entries()].flatMap(([d, l]) => hunterPeople(l.emails, d, cleanEmail, cleanLinkedinProfile)), webPeople)
    .slice(0, MAX_HUNTER_PEOPLE_PER_LEAD);
  const toInsert: Record<string, unknown>[] = [];
  for (const p of found) {
    if (emailOnLead([...rows, ...created], p.email) || toInsert.some((r) => r.email === p.email)) continue;
    const same = findSamePerson([...rows, ...created], p.first_name, p.last_name);
    if (same) {
      // The same person is already on the lead (for example a registry officer): fill their blanks, never add twice.
      if (!same.dismissed_at && !str(same.email)) {
        const saved = await fillBlanks(service, same, { email: p.email, title: p.title, ...(p.linkedin_url ? { linkedin_url: p.linkedin_url } : {}) });
        if (saved) { Object.assign(same, saved); stats.officerEmails++; }
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
  stats.hunterPeople = insertedHunter.length;

  // (3) Companies House officers, then a wide lookup for each officer without an email
  if (registry.number && chKey && left() > 15_000) {
    const officers = await fetchActiveOfficers(registry.number, chKey);
    const officerRows: Record<string, unknown>[] = [];
    for (const o of officers) {
      if (!o.first_name || !o.last_name || findSamePerson([...rows, ...created], o.first_name, o.last_name)) continue;
      if (officerRows.some((r) => r.first_name === o.first_name && r.last_name === o.last_name)) continue;
      officerRows.push({ lead_id: lead.id, source: 'companies_house', first_name: o.first_name, last_name: o.last_name, title: o.title, created_by: run.created_by });
    }
    if (officerRows.length > 0) {
      const { data, error } = await service.from('decision_maker_candidates').insert(officerRows).select('*');
      if (error) stats.failures++;
      else { created.push(...((data ?? []) as Contact[])); stats.officersAdded = (data ?? []).length; }
    }
  }
  const all = () => [...rows, ...created];
  const officersToLook = rankPeople(all().filter((r) => (r.source === 'companies_house' || r.source === 'cro')
    && !r.dismissed_at && !str(r.email) && str(r.first_name) && str(r.last_name)), webPeople).slice(0, MAX_OFFICER_LOOKUPS);
  const knownAddresses: KnownAddress[] = all().filter((r) => r.kind !== 'general' && str(r.email))
    .map((r) => ({ email: str(r.email)!, first: str(r.first_name), last: str(r.last_name) }));
  for (const officer of officersToLook) {
    if (left() < 15_000 || domains.length === 0) break;
    const first = str(officer.first_name)!;
    const last = str(officer.last_name)!;
    const work: FoundFields = { email: null, phone: str(officer.phone), linkedin_url: str(officer.linkedin_url) };
    const patch: Record<string, string> = {};
    const wide = await runWideLookup({
      first, last, have: { email: null, linkedin_url: work.linkedin_url ?? null, phone: work.phone ?? null }, hasApolloId: false,
      domains: domains.slice(0, 4), website: usableSite ? str(lead.website) : null,
      websiteDirectory: !!siteDomain && isDirectoryDomain(siteDomain), knownAddresses, usePaid: true,
      keys: { hunter: !!hunterKey, apollo: false, gemini: !!geminiKey },
      budgetMs: Math.min(15_000, left() - 8_000), webExtraMs: 5_000,
    }, {
      now: () => Date.now(),
      takeSlot: async () => true, // the lead's own Deep find slot already covers this
      hunterFind: async (d, f, l, t) => (await spend.hunter() ? hunterFindEmail(d, f, l, hunterKey ?? '', t) : { ok: false, failure: 429 }),
      hunterDomain: async (d, t) => {
        const cached = lists.get(d);
        if (cached) return { ok: true, ...cached };
        return await spend.hunter() ? hunterDomainList(d, hunterKey ?? '', t) : { ok: false, failure: 429 };
      },
      hunterVerify: async (e, t) => (await spend.hunter() ? hunterVerifyEmail(e, hunterKey ?? '', t) : { ok: false, failure: 429 }),
      scanWebsite: (w, d, f, l, t) => scanWebsiteForPerson(w, d, f, l, t),
      webSearch: async (t) => (await spend.ai()
        ? webSearchForPerson({ first, last, title: str(officer.title), company: str(lead.business_name), domains }, geminiKey ?? '', t)
        : { ok: false, failure: 429 }),
      apolloMatch: async () => ({ ok: false, failure: 403 }),
      absorb: (f) => {
        const merged = mergeFoundIntoPerson(work, f);
        if (merged.patch.email && emailOnLead(all(), merged.patch.email)) { delete merged.patch.email; delete merged.applied.email; }
        Object.assign(work, merged.patch);
        Object.assign(patch, merged.patch);
        return merged.applied;
      },
    });
    for (const s of wide.suggestions) {
      suggestions.push({ name: `${first} ${last}`.slice(0, 80), field: s.field, value: s.value.slice(0, 200), label: s.label });
    }
    if (Object.keys(patch).length > 0) {
      const saved = await fillBlanks(service, officer, patch);
      if (saved) { Object.assign(officer, saved); if (patch.email) stats.officerEmails++; }
    }
  }

  // (4) team pages and (5) the web search: names only, never stored unless already a contact
  const sitePeople: SitePerson[] = [];
  for (const html of pages) for (const p of extractTeamMembers(html)) {
    if (!sitePeople.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) sitePeople.push(p);
  }
  const namedOnSite = sitePeople.filter((p) => !namedPersonIsStored(p.name, all())).slice(0, 10);
  const namedByWeb = webPeople.filter((p) => !namedPersonIsStored(p.name, all())).slice(0, 10)
    .map((p) => ({ ...p, also_on_site: namedOnSite.some((s) => s.name.toLowerCase() === p.name.toLowerCase()) }));
  stats.namedOnSite = namedOnSite.length;
  stats.namedByWeb = namedByWeb.length;
  stats.hunterCapHit = spend.hunterHit;
  stats.aiCapHit = spend.aiHit;

  // LinkedIn auto-capture, like findDecisionMakers, for contacts this run created or filled
  for (const c of [...created, ...rows.filter((r) => str(r.linkedin_url))]) {
    if (!str(c.linkedin_url) || c.dismissed_at) continue;
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
      registered_name: registry.name,
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
