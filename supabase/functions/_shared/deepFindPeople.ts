// supabase/functions/_shared/deepFindPeople.ts
// Deep find: looks up every person to look up (contacts without an email, registry officers, names already on the
// lead) against the company's CONFIRMED domains with the existing wide lookup (Hunter finder, company list, pattern
// with verifier, the company website, web search). Service client only. Every email found keeps follow-ups off.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  hunterDomainList, hunterFindEmail, hunterVerifyEmail, scanWebsiteForPerson, webSearchForPerson,
} from './knownPersonLookup.ts';
import { mergeFoundIntoPerson, type FoundFields } from './knownPerson.ts';
import { runWideLookup, type KnownAddress } from './knownPersonWideRun.ts';
import type { StepId } from './knownPersonWide.ts';
import { emailOnLead, type ExistingContact, type PersonToLookUp } from './deepFindRules.ts';

type Contact = ExistingContact & Record<string, unknown>;

/** A provider-credit gate: true when one more unit may be spent. */
export interface SpendGate { hunter: () => Promise<boolean>; ai: () => Promise<boolean> }

/** What the people step needs. */
export interface PeopleContext {
  service: SupabaseClient;
  run: { created_by: string };
  lead: { id: string; website: string | null; business_name: string | null };
  people: PersonToLookUp[];
  /** All contacts on the lead right now (existing and created by this run). */
  contacts: () => Contact[];
  /** Confirmed company domains only. */
  domains: string[];
  website: string | null;
  websiteDirectory: boolean;
  /** Hunter company lists already fetched this run, by domain. */
  lists: Map<string, { emails: unknown[]; pattern: string | null }>;
  keys: { hunterKey: string | null; geminiKey: string | null };
  spend: SpendGate;
  /** Milliseconds left in the lead's budget. */
  left: () => number;
}

/** One person's line in the results. */
export interface PersonResult { name: string; role: string | null; source: PersonToLookUp['source']; email_found: boolean }

/** The outcome of the people step. */
export interface PeopleOutcome {
  results: PersonResult[];
  /** Contacts filled in or created (for LinkedIn capture and counting). */
  touched: Contact[];
  created: Contact[];
  emailsFound: number;
  suggestions: { name: string; field: string; value: string; label: string }[];
}

/** Steps whose email is a Hunter result (finder, company list, pattern verified by Hunter): safe to store for a new person. */
const HUNTER_EMAIL_STEPS: StepId[] = ['hunter_finder', 'hunter_domain', 'pattern'];
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const nowIso = () => new Date().toISOString();

/** Fills blank fields of an existing contact, never overwriting; an email turns its follow-ups off. */
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

/**
 * Looks up each person (at most 5, while at least 15 s of the lead's budget is left). An existing contact gets its
 * blanks filled. A person who is not a contact yet (a name on the lead) is stored as a new `hunter` contact ONLY when
 * Hunter itself supplied the email on a confirmed domain; anything else (website or web finds, guesses) becomes a
 * suggestion. Credits are reserved before every Hunter and AI call.
 */
export async function lookUpPeople(ctx: PeopleContext): Promise<PeopleOutcome> {
  const out: PeopleOutcome = { results: [], touched: [], created: [], emailsFound: 0, suggestions: [] };
  const { hunterKey, geminiKey } = ctx.keys;
  for (const person of ctx.people.slice(0, 5)) {
    const name = `${person.first} ${person.last}`.slice(0, 80);
    if (ctx.left() < 15_000 || ctx.domains.length === 0) { out.results.push({ name, role: person.title, source: person.source, email_found: false }); continue; }
    const contact = person.contactId ? ctx.contacts().find((c) => c.id === person.contactId) ?? null : null;
    const work: FoundFields = { email: null, phone: str(contact?.phone), linkedin_url: str(contact?.linkedin_url) };
    const patch: Record<string, string> = {};
    let emailStep: StepId | null = null;
    const knownAddresses: KnownAddress[] = ctx.contacts().filter((r) => r.kind !== 'general' && str(r.email))
      .map((r) => ({ email: str(r.email)!, first: str(r.first_name), last: str(r.last_name) }));
    const wide = await runWideLookup({
      first: person.first, last: person.last, have: { email: null, linkedin_url: work.linkedin_url ?? null, phone: work.phone ?? null },
      hasApolloId: false, domains: ctx.domains.slice(0, 4), website: ctx.website, websiteDirectory: ctx.websiteDirectory,
      knownAddresses, usePaid: true, keys: { hunter: !!hunterKey, apollo: false, gemini: !!geminiKey },
      budgetMs: Math.min(15_000, ctx.left() - 8_000), webExtraMs: 5_000,
    }, {
      now: () => Date.now(),
      takeSlot: async () => true, // the lead's own Deep find slot already covers this
      hunterFind: async (d, f, l, t) => (await ctx.spend.hunter() ? hunterFindEmail(d, f, l, hunterKey ?? '', t) : { ok: false, failure: 429 }),
      hunterDomain: async (d, t) => {
        const cached = ctx.lists.get(d);
        if (cached) return { ok: true, ...cached };
        return await ctx.spend.hunter() ? hunterDomainList(d, hunterKey ?? '', t, 10) : { ok: false, failure: 429 };
      },
      hunterVerify: async (e, t) => (await ctx.spend.hunter() ? hunterVerifyEmail(e, hunterKey ?? '', t) : { ok: false, failure: 429 }),
      scanWebsite: (w, d, f, l, t) => scanWebsiteForPerson(w, d, f, l, t),
      webSearch: async (t) => (await ctx.spend.ai()
        ? webSearchForPerson({ first: person.first, last: person.last, title: person.title, company: ctx.lead.business_name, domains: ctx.domains }, geminiKey ?? '', t)
        : { ok: false, failure: 429 }),
      apolloMatch: async () => ({ ok: false, failure: 403 }),
      absorb: (f, step) => {
        const merged = mergeFoundIntoPerson(work, f);
        if (merged.patch.email && emailOnLead(ctx.contacts(), merged.patch.email)) { delete merged.patch.email; delete merged.applied.email; }
        if (merged.applied.email && !emailStep) emailStep = step;
        Object.assign(work, merged.patch);
        Object.assign(patch, merged.patch);
        return merged.applied;
      },
    });
    for (const s of wide.suggestions) out.suggestions.push({ name, field: s.field, value: s.value.slice(0, 200), label: s.label });
    let emailFound = false;
    if (contact && Object.keys(patch).length > 0) {
      const saved = await fillBlanks(ctx.service, contact, patch);
      if (saved) { Object.assign(contact, saved); out.touched.push(contact); emailFound = !!patch.email; }
    } else if (!contact && patch.email && emailStep && HUNTER_EMAIL_STEPS.includes(emailStep)) {
      const { data, error } = await ctx.service.from('decision_maker_candidates').upsert({
        lead_id: ctx.lead.id, source: 'hunter', kind: 'person', first_name: person.first, last_name: person.last, title: person.title,
        email: patch.email, email_revealed: true, name_obfuscated: false, linkedin_url: patch.linkedin_url ?? null,
        include_in_sequences: false, is_primary: false, created_by: ctx.run.created_by,
      }, { onConflict: 'lead_id,dedupe_key', ignoreDuplicates: true }).select('*');
      if (!error && data && data.length > 0) { out.created.push(data[0] as Contact); out.touched.push(data[0] as Contact); emailFound = true; }
    } else if (!contact && patch.email) {
      out.suggestions.push({ name, field: 'email', value: patch.email, label: 'Found on the website, check it' });
    }
    if (emailFound) out.emailsFound++;
    out.results.push({ name, role: person.title, source: person.source, email_found: emailFound });
  }
  return out;
}
