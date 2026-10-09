// supabase/functions/_shared/knownPersonFlow.ts
// "I know this person" flow for find-decision-makers: save the typed person first, then fill blank fields from Hunter / Apollo.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ContactEditValue } from './contacts.ts';
import {
  domainFromWebsite, emailOnDomain, emailTakenByOther, isDirectoryDomain, LOOKUP_LIMIT_MESSAGE, mergeFoundIntoPerson,
  needsRateSlot, normName, planLookups, plainLookupError, type FoundFields,
} from './knownPerson.ts';
import { apolloMatchPerson, hunterFindEmail, isPublicDomain } from './knownPersonLookup.ts';
import { checkRateLimit } from './rateLimit.ts';

type Row = Record<string, unknown>;
type Source = 'hunter' | 'apollo' | 'you';
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
  };
}

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
  lead: { id: string; org_id: string; website: string | null },
  typed: ContactEditValue, userId: string,
  keys: { hunterKey: string | null; apolloKey: string | null },
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

  // (b) lookups: only blank fields, only with keys, never fatal
  const sources: NonNullable<KnownPersonOutcome['known_person']>['sources'] = {};
  for (const f of ['email', 'phone', 'linkedin_url'] as const) if (str(saved[f])) sources[f] = 'you';
  const work = { title: str(saved.title), email: str(saved.email), phone: str(saved.phone), linkedin_url: str(saved.linkedin_url) };
  const first = str(saved.first_name) ?? '';
  const last = str(saved.last_name) ?? '';
  const domain = domainFromWebsite(lead.website);
  const publicDomain = domain && isPublicDomain(domain) ? domain : null;
  const directory = publicDomain !== null && isDirectoryDomain(publicDomain);
  const planFor = (domainOk: boolean) => planLookups({
    usePaid, hunterKey: !!keys.hunterKey, apolloKey: !!keys.apolloKey, domainOk,
    hasFirst: first !== '', hasLast: last !== '', hasEmail: !!work.email, hasLinkedin: !!work.linkedin_url,
    hasApolloId: !!str(saved.apollo_person_id),
  });
  if (directory && needsRateSlot(planFor(true))) {
    errors.push('The lead\'s website is a social or directory page, so no lookup was run');
  }
  let plan = planFor(publicDomain !== null && !directory);
  if (needsRateSlot(plan)) {
    let allowed = false;
    try {
      allowed = await checkRateLimit(service, `fdm-known:${lead.org_id}:${lead.id}`, 5, 24 * 60)
        && await checkRateLimit(service, `fdm-known:${lead.org_id}`, 100, 24 * 60);
    } catch { allowed = false; }
    if (!allowed) {
      errors.push(LOOKUP_LIMIT_MESSAGE);
      plan = { hunter: false, apollo: false };
    }
  }

  let extraEmail: string | undefined;
  let hunterCalled = false;
  let apolloCalled = false;
  const pending: { applied: FoundFields; source: 'hunter' | 'apollo' }[] = [];
  const patch: Row = {};
  const absorb = (from: FoundFields, source: 'hunter' | 'apollo') => {
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
    pending.push({ applied: merged.applied, source });
  };

  if (plan.hunter && keys.hunterKey && publicDomain) {
    hunterCalled = true;
    const res = await hunterFindEmail(publicDomain, first, last, keys.hunterKey);
    if (!res.ok) errors.push(plainLookupError('hunter', res.failure));
    else absorb(res.found.email && emailOnDomain(res.found.email, publicDomain) ? res.found : {}, 'hunter');
  }
  const apolloStillUseful = !work.email || !work.linkedin_url;
  if (plan.apollo && apolloStillUseful && keys.apolloKey && publicDomain) {
    apolloCalled = true;
    const res = await apolloMatchPerson(publicDomain, first, last, keys.apolloKey);
    if (!res.ok) errors.push(plainLookupError('apollo', res.failure));
    else absorb(res.found, 'apollo');
  }

  // (c) save what was found: blank fields only, via the service client; Apollo-found data follows reveal semantics
  let final = saved;
  const found: Fields3 = {};
  if (Object.keys(patch).length > 0) {
    const apolloApplied = pending.find((p) => p.source === 'apollo')?.applied ?? {};
    const write = async (cols: Row) => service.from('decision_maker_candidates')
      .update({ ...cols, updated_at: new Date().toISOString() }).eq('id', saved.id as string).select('*').single();
    const cols: Row = { ...patch };
    if (apolloApplied.email && patch.email === apolloApplied.email) cols.email_revealed = true;
    if (apolloApplied.phone && patch.phone === apolloApplied.phone) cols.phone_status = 'revealed';
    let res = await write(cols);
    if (res.error?.code === '23505' && cols.email) {
      delete cols.email; delete cols.email_revealed; errors.push(EMAIL_TAKEN);
      res = Object.keys(cols).length > 0 ? await write(cols) : { data: null, error: null } as never;
    }
    if (res.error) {
      errors.push('Details were found but could not be saved. Try again.');
    } else if (res.data) {
      final = res.data as Row;
      for (const p of pending) for (const f of ['email', 'phone', 'linkedin_url'] as const) {
        const v = p.applied[f];
        if (v && lower(final[f]) === v.toLowerCase()) { found[f] = v; sources[f] = p.source; }
      }
    }
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
      hunter_called: hunterCalled, apollo_called: apolloCalled,
    },
  };
}
