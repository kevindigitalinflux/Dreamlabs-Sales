// supabase/functions/_shared/knownPersonFlow.ts
// "I know this person" flow for find-decision-makers: save the typed person first, then fill blank fields from Hunter / Apollo.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { ContactEditValue } from './contacts.ts';
import { domainFromWebsite, mergeFoundIntoPerson, plainLookupError, type FoundFields } from './knownPerson.ts';
import { apolloMatchPerson, hunterFindEmail, isPublicDomain } from './knownPersonLookup.ts';

type Row = Record<string, unknown>;
type Source = 'hunter' | 'apollo' | 'you';

export interface KnownPersonOutcome {
  status: number;
  error?: string;
  candidates?: Row[];
  known_person?: {
    saved: true; contact_id: string;
    found: { email?: string; phone?: string; linkedin_url?: string };
    sources: { email?: Source; phone?: Source; linkedin_url?: Source };
    errors: string[]; extra_email?: string; apollo_called: boolean;
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const norm = (v: unknown): string => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/** Blank typed fields of an existing row that the typed person can fill (never overwrites). */
function typedFill(row: Row, typed: ContactEditValue): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const f of ['title', 'email', 'linkedin_url'] as const) {
    if (!str(row[f]) && typed[f]) patch[f] = typed[f]!;
  }
  return patch;
}

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
): Promise<KnownPersonOutcome> {
  const { data: existingRows, error: readErr } = await service.from('decision_maker_candidates')
    .select('*').eq('lead_id', lead.id).eq('kind', 'person');
  if (readErr) return { status: 500, error: 'Could not read this lead\'s contacts.' };
  const all = (existingRows ?? []) as Row[];
  const live = all.filter((r) => !r.dismissed_at);

  // (a) find an existing person: by email when one was typed, otherwise by first + last name
  const sameName = (r: Row) => norm(r.first_name) === norm(typed.first_name) && norm(r.last_name) === norm(typed.last_name);
  const pool = (rows: Row[]) => rows.filter((r) => (typed.email ? norm(r.email) === typed.email : sameName(r)));
  const liveMatches = pool(live);
  const match = liveMatches.find((r) => r.source === 'manual') ?? liveMatches[0]
    ?? pool(all.filter((r) => r.dismissed_at && r.source === 'manual'))[0] ?? null;

  let row: Row;
  if (match) {
    const isProvider = match.source !== 'manual' && match.source !== 'dream_agent';
    const revive = Boolean(match.dismissed_at);
    const patch: Row = { ...typedFill(match, typed), updated_at: new Date().toISOString() };
    if (revive) { patch.dismissed_at = null; patch.include_in_sequences = true; }
    // The caller's client always runs the update (even a no-op), so RLS proves they can edit this lead.
    const probe = await client.from('decision_maker_candidates')
      .update(isProvider ? { updated_at: patch.updated_at } : patch).eq('id', match.id as string).select('*');
    if (probe.error || !probe.data || probe.data.length === 0) {
      return { status: 403, error: 'You do not have permission to change contacts on this lead.' };
    }
    row = probe.data[0] as Row;
    if (isProvider) {
      const fill = typedFill(match, typed);
      if (Object.keys(fill).length > 0) {
        const { data } = await service.from('decision_maker_candidates').update(fill).eq('id', match.id as string).select('*').single();
        if (data) row = data as Row;
      }
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

  // (b) lookups: only blank fields, only with keys, never fatal
  const errors: string[] = [];
  const sources: NonNullable<KnownPersonOutcome['known_person']>['sources'] = {};
  for (const f of ['email', 'phone', 'linkedin_url'] as const) if (str(row[f])) sources[f] = 'you';
  const found: NonNullable<KnownPersonOutcome['known_person']>['found'] = {};
  let extraEmail: string | undefined;
  let apolloCalled = false;
  const first = str(row.first_name) ?? '';
  const last = str(row.last_name) ?? '';
  const domain = domainFromWebsite(lead.website);
  const safeDomain = domain && isPublicDomain(domain) ? domain : null;

  const apply = (from: FoundFields, source: 'hunter' | 'apollo') => {
    const merged = mergeFoundIntoPerson(
      { title: str(row.title), email: str(row.email), phone: str(row.phone), linkedin_url: str(row.linkedin_url) }, from);
    if (merged.extra_email) extraEmail = merged.extra_email;
    return { ...merged, source };
  };
  const pending: { patch: Record<string, string>; applied: FoundFields; source: 'hunter' | 'apollo' }[] = [];
  const track = (m: ReturnType<typeof apply>) => {
    Object.assign(row, m.patch);
    pending.push({ patch: m.patch, applied: m.applied, source: m.source });
  };

  if (safeDomain) {
    if (keys.hunterKey && !str(row.email) && first && last) {
      const res = await hunterFindEmail(safeDomain, first, last, keys.hunterKey);
      if (res.ok) track(apply(res.found, 'hunter')); else errors.push(plainLookupError('hunter', res.failure));
    }
    const blank = !str(row.email) || !str(row.phone) || !str(row.linkedin_url);
    if (keys.apolloKey && blank && first) {
      apolloCalled = true;
      const res = await apolloMatchPerson(safeDomain, first, last, keys.apolloKey);
      if (res.ok) track(apply(res.found, 'apollo')); else errors.push(plainLookupError('apollo', res.failure));
    }
  }

  // (c) save what was found: blank fields only, via the service client; Apollo-found data follows reveal semantics
  const patch: Row = {};
  for (const p of pending) {
    Object.assign(patch, p.patch);
    if (p.source === 'apollo' && p.applied.email) patch.email_revealed = true;
    if (p.source === 'apollo' && p.applied.phone) patch.phone_status = 'revealed';
  }
  if (Object.keys(patch).length > 0) {
    const { data, error } = await service.from('decision_maker_candidates')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', row.id as string).select('*').single();
    if (error || !data) {
      errors.push('Details were found but could not be saved. Try again.');
    } else {
      row = data as Row;
      for (const p of pending) for (const f of ['email', 'phone', 'linkedin_url'] as const) {
        const v = p.applied[f];
        if (v) { found[f] = v; sources[f] = p.source; }
      }
    }
  }

  if (str(row.linkedin_url)) {
    const fullName = `${str(row.first_name) ?? ''} ${str(row.last_name) ?? ''}`.trim() || 'Unknown';
    const { error } = await service.from('linkedin_contacts').upsert({
      org_id: lead.org_id, lead_id: lead.id, decision_maker_candidate_id: row.id,
      full_name: fullName, linkedin_url: row.linkedin_url, context_signal: null, created_by: userId,
    }, { onConflict: 'decision_maker_candidate_id' });
    if (error) console.error('Failed to auto-capture linkedin_contacts row for known person');
  }

  const { data: candidates } = await service.from('decision_maker_candidates')
    .select('*').eq('lead_id', lead.id).is('dismissed_at', null).order('created_at').limit(100);
  return {
    status: 200,
    candidates: (candidates ?? []) as Row[],
    known_person: {
      saved: true, contact_id: row.id as string, found, sources, errors,
      ...(extraEmail ? { extra_email: extraEmail } : {}), apollo_called: apolloCalled,
    },
  };
}
