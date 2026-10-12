// supabase/functions/_shared/knownPersonFlow.ts
// "I know this person" flow for find-decision-makers: save the typed person first, then fill blank fields with the
// wider lookup (Hunter finder, Hunter company list, email pattern, the company website, web search, Apollo).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ContactEditValue } from './contacts.ts';
import {
  domainFromWebsite, emailTakenByOther, isDirectoryDomain, LOOKUP_LIMIT_MESSAGE, mergeFoundIntoPerson,
  normName, type FoundFields,
} from './knownPerson.ts';
import {
  apolloMatchPerson, hunterDomainList, hunterFindEmail, hunterVerifyEmail, isPublicDomain, scanWebsiteForPerson,
  webSearchForPerson,
} from './knownPersonLookup.ts';
import { runWideLookup } from './knownPersonWideRun.ts';
import type { StepId, StepResult, Suggestion } from './knownPersonWide.ts';
import { checkRateLimit } from './rateLimit.ts';

type Row = Record<string, unknown>;
/** Who supplied a value: Hunter (finder or company list), Apollo, the email pattern, the company website, or the user. */
type Source = 'hunter' | 'apollo' | 'pattern' | 'website' | 'you';
type Fields3 = { email?: string; phone?: string; linkedin_url?: string };

export interface KnownPersonOutcome {
  status: number;
  error?: string;
  candidates?: Row[];
  known_person?: {
    saved: true; contact_id: string;
    found: Fields3;
    sources: { email?: Source; phone?: Source; linkedin_url?: Source };
    errors: string[]; notes: string[]; extra_email?: string;
    hunter_called: boolean; apollo_called: boolean;
    /** Each lookup step in order, with a fixed plain-English detail. */
    steps: StepResult[];
    /** Values found but not saved (web search, unverified pattern guess), for a one-click "Use this". */
    suggestions: Suggestion[];
    /** True when a found email was saved and follow-up sequences were switched off for this contact. */
    sequences_turned_off?: boolean;
  };
}

/** Steps whose found email is saved but must not be emailed by a sequence until the user switches it on. */
const WIDER_EMAIL_STEPS: StepId[] = ['hunter_domain', 'pattern', 'website'];
/** Source label per step. Web-search finds are never saved (they are suggestions), so 'web' never reaches a saved field. */
const STEP_SOURCE: Record<Exclude<StepId, 'web'>, Exclude<Source, 'you'>> = {
  hunter_finder: 'hunter', hunter_domain: 'hunter', pattern: 'pattern', website: 'website', apollo: 'apollo',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const lower = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const byOldest = (a: Row, b: Row) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));
const EMAIL_TAKEN = 'That email is already on this lead';

/**
 * Saves the typed person (a manual contact, or an existing contact on the lead), then looks up blank fields.
 * `client` is the caller's RLS client: it performs the insert and the permission check (migration 050 policies enforce
 * edit rights). `service` writes provider-owned columns (email_revealed, phone_status) and provider-row fills.
 * The membership check must already have passed. A lookup failure never undoes or blocks the save.
 */
export async function runKnownPerson(
  client: SupabaseClient, service: SupabaseClient,
  lead: { id: string; org_id: string; website: string | null; business_name?: string | null },
  typed: ContactEditValue, userId: string,
  keys: { hunterKey: string | null; apolloKey: string | null; geminiKey: string | null },
  usePaid: boolean,
): Promise<KnownPersonOutcome> {
  const { data: allData, error: readErr } = await service.from('decision_maker_candidates')
    .select('*').eq('lead_id', lead.id);
  if (readErr) return { status: 500, error: 'Could not read this lead\'s contacts.' };
  const allRows = (allData ?? []) as Row[];
  const people = allRows.filter((r) => r.kind === 'person');
  const live = people.filter((r) => !r.dismissed_at).sort(byOldest);

  // (a) find an existing person: by email when typed (then a same-name row with no email), else by first + last name
  const sameName = (r: Row) => normName(r.first_name as string) === normName(typed.first_name)
    && normName(r.last_name as string) === normName(typed.last_name);
  let match: Row | undefined;
  if (typed.email) {
    const byEmail = live.filter((r) => lower(r.email) === typed.email);
    match = byEmail.find((r) => r.source === 'manual') ?? byEmail[0]
      ?? people.filter((r) => r.dismissed_at && r.source === 'manual' && lower(r.email) === typed.email).sort(byOldest)[0]
      ?? live.find((r) => sameName(r) && !str(r.email));
  } else {
    match = live.find(sameName);
  }

  const notes: string[] = [];
  const errors: string[] = [];
  let row: Row;
  if (match) {
    const isProvider = match.source !== 'manual' && match.source !== 'dream_agent';
    const fill: Record<string, string> = {};
    for (const [f, label] of [['title', 'position'], ['email', 'email'], ['linkedin_url', 'LinkedIn link']] as const) {
      const typedValue = typed[f];
      if (!typedValue) continue;
      if (!str(match[f])) {
        if (f === 'email' && emailTakenByOther(typedValue, allRows, match.id as string)) errors.push(EMAIL_TAKEN);
        else fill[f] = typedValue;
      } else if (lower(match[f]) !== typedValue.toLowerCase()) {
        notes.push(`Kept the ${label} already saved for this person.`);
      }
    }
    const revive = Boolean(match.dismissed_at);
    const patch: Row = { ...fill, updated_at: new Date().toISOString() };
    if (revive) { patch.dismissed_at = null; patch.include_in_sequences = true; }
    // The caller's client always runs the update (a no-op for provider rows), so RLS proves they can edit this lead.
    const probe = await client.from('decision_maker_candidates')
      .update(isProvider ? { updated_at: patch.updated_at } : patch).eq('id', match.id as string).select('*');
    if (probe.error || !probe.data || probe.data.length === 0) {
      return { status: 403, error: 'You do not have permission to change contacts on this lead.' };
    }
    row = probe.data[0] as Row;
    if (isProvider && Object.keys(fill).length > 0) {
      const { data, error } = await service.from('decision_maker_candidates').update(fill).eq('id', match.id as string).select('*').single();
      if (error || !data) errors.push('Your extra details could not be saved on the existing contact.');
      else row = data as Row;
    }
  } else {
    const { data, error } = await client.from('decision_maker_candidates').insert({
      lead_id: lead.id, source: 'manual', kind: 'person',
      first_name: typed.first_name, last_name: typed.last_name, title: typed.title,
      email: typed.email, linkedin_url: typed.linkedin_url,
      is_primary: false, include_in_sequences: true, created_by: userId,
    }).select('*').single();
    if (error || !data) {
      if (error?.code === '23505') return { status: 409, error: 'That email is already saved on this lead as another contact.' };
      if (error?.code === '42501') return { status: 403, error: 'You do not have permission to change contacts on this lead.' };
      return { status: 500, error: 'Could not save this person.' };
    }
    row = data as Row;
  }
  const saved = row; // the database state; lookups never mutate it

  // (b) lookups: only blank fields, only with keys, never fatal; one rate-limit slot for the whole run
  const sources: NonNullable<KnownPersonOutcome['known_person']>['sources'] = {};
  for (const f of ['email', 'phone', 'linkedin_url'] as const) if (str(saved[f])) sources[f] = 'you';
  const work = { title: str(saved.title), email: str(saved.email), phone: str(saved.phone), linkedin_url: str(saved.linkedin_url) };
  const first = str(saved.first_name) ?? '';
  const last = str(saved.last_name) ?? '';
  const domain = domainFromWebsite(lead.website);
  const publicDomain = domain && isPublicDomain(domain) ? domain : null;
  const directory = publicDomain !== null && isDirectoryDomain(publicDomain);

  let extraEmail: string | undefined;
  const pending: { applied: FoundFields; step: StepId }[] = [];
  const patch: Row = {};
  const absorb = (from: FoundFields, step: StepId): FoundFields => {
    const merged = mergeFoundIntoPerson(work, from);
    if (merged.patch.email && emailTakenByOther(merged.patch.email, allRows, saved.id as string)) {
      delete merged.patch.email; delete merged.applied.email; errors.push(EMAIL_TAKEN);
    }
    if (merged.extra_email) {
      if (emailTakenByOther(merged.extra_email, allRows, saved.id as string)) errors.push(EMAIL_TAKEN);
      else extraEmail = merged.extra_email;
    }
    Object.assign(work, merged.patch);
    Object.assign(patch, merged.patch);
    pending.push({ applied: merged.applied, step });
    return merged.applied;
  };

  const hunterKey = keys.hunterKey;
  const apolloKey = keys.apolloKey;
  const geminiKey = keys.geminiKey;
  const wide = await runWideLookup({
    first, last,
    have: { email: work.email, linkedin_url: work.linkedin_url, phone: work.phone },
    hasApolloId: !!str(saved.apollo_person_id),
    domain: publicDomain, directory, website: str(lead.website), usePaid,
    keys: { hunter: !!hunterKey, apollo: !!apolloKey, gemini: !!geminiKey },
  }, {
    now: () => Date.now(),
    takeSlot: async () => await checkRateLimit(service, `fdm-known:${lead.org_id}:${lead.id}`, 20, 24 * 60)
      && await checkRateLimit(service, `fdm-known:${lead.org_id}`, 100, 24 * 60),
    hunterFind: (d, f, l, t) => hunterFindEmail(d, f, l, hunterKey ?? '', t),
    hunterDomain: (d, t) => hunterDomainList(d, hunterKey ?? '', t),
    hunterVerify: (e, t) => hunterVerifyEmail(e, hunterKey ?? '', t),
    scanWebsite: (w, d, f, l, t) => scanWebsiteForPerson(w, d, f, l, t),
    webSearch: (t) => webSearchForPerson({
      first, last, title: work.title, company: str(lead.business_name), domain: publicDomain ?? '',
    }, geminiKey ?? '', t),
    apolloMatch: (d, f, l, t) => apolloMatchPerson(d, f, l, apolloKey ?? '', t),
    absorb,
  });
  if (wide.limitReached) errors.push(LOOKUP_LIMIT_MESSAGE);
  // A found address must not already belong to another contact on this lead.
  const suggestions = wide.suggestions.filter((s) => s.field !== 'email' || !emailTakenByOther(s.value, allRows, saved.id as string));

  // (c) save what was found: blank fields only, via the service client; Apollo-found data follows reveal semantics
  let final = saved;
  const found: Fields3 = {};
  let sequencesTurnedOff = false;
  if (Object.keys(patch).length > 0) {
    const apolloApplied = pending.find((p) => p.step === 'apollo')?.applied ?? {};
    const emailStep = pending.find((p) => p.applied.email)?.step;
    const write = async (cols: Row) => service.from('decision_maker_candidates')
      .update({ ...cols, updated_at: new Date().toISOString() }).eq('id', saved.id as string).select('*').single();
    const cols: Row = { ...patch };
    if (apolloApplied.email && patch.email === apolloApplied.email) cols.email_revealed = true;
    if (apolloApplied.phone && patch.phone === apolloApplied.phone) cols.phone_status = 'revealed';
    // An address found on the company list, by pattern or on the website is never emailed by a sequence until switched on.
    const turnOff = !!cols.email && !!emailStep && WIDER_EMAIL_STEPS.includes(emailStep) && saved.include_in_sequences === true;
    if (turnOff) cols.include_in_sequences = false;
    let res = await write(cols);
    if (res.error?.code === '23505' && cols.email) {
      delete cols.email; delete cols.email_revealed; delete cols.include_in_sequences; errors.push(EMAIL_TAKEN);
      res = Object.keys(cols).length > 0 ? await write(cols) : { data: null, error: null } as never;
    }
    if (res.error) {
      errors.push('Details were found but could not be saved. Try again.');
    } else if (res.data) {
      final = res.data as Row;
      sequencesTurnedOff = cols.include_in_sequences === false && final.include_in_sequences === false;
      for (const p of pending) for (const f of ['email', 'phone', 'linkedin_url'] as const) {
        const v = p.applied[f];
        if (v && lower(final[f]) === v.toLowerCase()) { found[f] = v; if (p.step !== 'web') sources[f] = STEP_SOURCE[p.step]; }
      }
    }
  }
  if (sequencesTurnedOff) {
    notes.push('The email that was found is not used by follow-up sequences until you switch follow-ups on for this person.');
  }

  // LinkedIn auto-capture from values that are actually saved
  if (str(final.linkedin_url)) {
    const fullName = `${str(final.first_name) ?? ''} ${str(final.last_name) ?? ''}`.trim() || 'Unknown';
    const { error } = await service.from('linkedin_contacts').upsert({
      org_id: lead.org_id, lead_id: lead.id, decision_maker_candidate_id: final.id,
      full_name: fullName, linkedin_url: final.linkedin_url, context_signal: null, created_by: userId,
    }, { onConflict: 'decision_maker_candidate_id' });
    if (error) console.error('Failed to auto-capture linkedin_contacts row for known person');
  }

  const { data: candidates } = await service.from('decision_maker_candidates')
    .select('*').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at').limit(100);
  return {
    status: 200,
    candidates: (candidates ?? []) as Row[],
    known_person: {
      saved: true, contact_id: final.id as string, found, sources, errors, notes,
      ...(extraEmail ? { extra_email: extraEmail } : {}),
      hunter_called: wide.hunterCalled, apollo_called: wide.apolloCalled,
      steps: wide.steps, suggestions,
      ...(sequencesTurnedOff ? { sequences_turned_off: true } : {}),
    },
  };
}
