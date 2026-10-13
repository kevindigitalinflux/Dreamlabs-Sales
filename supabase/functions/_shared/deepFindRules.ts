// supabase/functions/_shared/deepFindRules.ts
// Pure rules for Deep find: request validation, turning provider people into contact rows, de-duplication, team-page
// names, and the plain-English per-lead summary. No imports on purpose: tested from src/lib. Provider, page and model
// text is untrusted data: every value is type-checked and cleaned, and only fixed sentences carry counts and domains.

export const MAX_DEEP_FIND_LEADS = 25;
/** Caps per run: `hunter` is Hunter CREDITS (one unit per Hunter request, each request limited to about one credit), `ai` is AI calls. */
export const DEFAULT_CAPS = { hunter: 60, ai: 25 } as const;
export const CAP_LIMITS = { hunter: 500, ai: 200 } as const;
/** At most this many people from Hunter lists are stored per lead. */
export const MAX_HUNTER_PEOPLE_PER_LEAD = 15;
/** At most this many registry officers get a wide lookup per lead. */
export const MAX_OFFICER_LOOKUPS = 3;
/** A running row older than this is treated as interrupted. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A validated create request. */
export type CreateRequest = { ok: true; leadIds: string[]; caps: { hunter: number; ai: number } } | { ok: false; error: string };

function cap(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

/** Validates `lead_ids` (1 to 25 distinct UUIDs) and the optional `caps` ({hunter, ai} whole numbers inside the limits). */
export function parseCreateRequest(body: unknown): CreateRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, error: 'Invalid request' };
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.lead_ids) || b.lead_ids.length === 0) return { ok: false, error: 'Choose at least one lead' };
  if (b.lead_ids.length > MAX_DEEP_FIND_LEADS) return { ok: false, error: `Choose ${MAX_DEEP_FIND_LEADS} leads or fewer` };
  const ids = [...new Set(b.lead_ids.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : '')))];
  if (ids.some((id) => !UUID_RE.test(id))) return { ok: false, error: 'Invalid lead id' };
  const caps = (typeof b.caps === 'object' && b.caps !== null && !Array.isArray(b.caps) ? b.caps : {}) as Record<string, unknown>;
  const hunter = cap(caps.hunter, DEFAULT_CAPS.hunter, CAP_LIMITS.hunter);
  const ai = cap(caps.ai, DEFAULT_CAPS.ai, CAP_LIMITS.ai);
  if (hunter === null) return { ok: false, error: `The Hunter credit cap must be a whole number from 0 to ${CAP_LIMITS.hunter}` };
  if (ai === null) return { ok: false, error: `The AI cap must be a whole number from 0 to ${CAP_LIMITS.ai}` };
  return { ok: true, leadIds: ids, caps: { hunter, ai } };
}

/** True for a UUID string. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Name key: accents removed, lowercase, letters only. */
export function nameKey(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '') : '';
}

/** A plain person-name part from a provider: letters, spaces, apostrophes, dots and hyphens, 1 to 40 characters. */
export function cleanNamePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  return t.length >= 1 && t.length <= 40 && /^[\p{L}][\p{L}\p{M}' .-]*$/u.test(t) ? t : null;
}

/** A job title from a provider: printable text, at most 100 characters, or null. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return t || null;
}

/** An existing contact row, as far as de-duplication needs it. */
export interface ExistingContact {
  id: string; kind?: unknown; source?: unknown; first_name?: unknown; last_name?: unknown; email?: unknown; dismissed_at?: unknown;
}

/** True when two first names plausibly name the same person: same name, or one is an initial or a prefix of the other. */
function firstAgrees(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * The existing person this name most likely is (same surname, agreeing first name), dismissed rows included so a
 * removed person is never re-added. Null when there is none, or when two different people match (never guesses).
 */
export function findSamePerson<T extends ExistingContact>(rows: T[], first: unknown, last: unknown): T | null {
  const f = nameKey(first);
  const l = nameKey(last);
  if (!f || !l) return null;
  const hits = rows.filter((r) => r.kind !== 'general' && nameKey(r.last_name) === l && firstAgrees(nameKey(r.first_name), f));
  return hits.length === 1 ? hits[0]! : null;
}

/** True when any row (any kind or source, dismissed or not) already carries this email, ignoring case. */
export function emailOnLead(rows: ExistingContact[], email: string): boolean {
  const e = email.trim().toLowerCase();
  return rows.some((r) => typeof r.email === 'string' && r.email.trim().toLowerCase() === e);
}

/** One person from a Hunter company list, ready to store. */
export interface HunterPerson { first_name: string; last_name: string; title: string; email: string; linkedin_url: string | null; seniority: string | null }

const GENERIC_LOCAL = /^(info|hello|hi|contact|contactus|enquiries|enquiry|sales|admin|office|support|help|mail|email|team|accounts|finance|reception|bookings?|jobs|careers|hr|marketing|press|media|no-?reply|webmaster|privacy|billing|orders|service|lettings|rentals)$/;

/**
 * Named people with a role from Hunter's company list (`data.emails[]`) whose address sits exactly on `domain` and is
 * not a shared mailbox. Every field is type-checked; `cleanEmail` and `cleanLinkedin` are the caller's validators.
 */
export function hunterPeople(
  emails: unknown, domain: string,
  cleanEmail: (v: unknown) => string | null, cleanLinkedin: (v: unknown) => string | null,
): HunterPerson[] {
  if (!Array.isArray(emails)) return [];
  const out: HunterPerson[] = [];
  const d = domain.toLowerCase();
  for (const raw of emails.slice(0, 200)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const email = cleanEmail(e.value);
    const first = cleanNamePart(e.first_name);
    const last = cleanNamePart(e.last_name);
    const title = cleanTitle(e.position);
    if (!email || !first || !last || !title) continue;
    const at = email.lastIndexOf('@');
    if (email.slice(at + 1) !== d || GENERIC_LOCAL.test(email.slice(0, at))) continue;
    if (out.some((p) => p.email === email)) continue;
    out.push({
      first_name: first, last_name: last, title, email,
      linkedin_url: cleanLinkedin(e.linkedin), seniority: typeof e.seniority === 'string' ? e.seniority.slice(0, 20) : null,
    });
  }
  return out;
}

/** A person named on the company's own website. */
export interface SitePerson { name: string; role: string }

const ROLE_WORDS = /\b(owner|founder|co-?founder|director|managing director|partner|principal|proprietor|ceo|chief|manager|head of|chair)\b/i;

/** Words that make a capitalised phrase a menu item or heading rather than a person's name. */
const NOT_NAME_WORDS = new Set([
  'contact', 'us', 'about', 'our', 'team', 'home', 'services', 'service', 'meet', 'the', 'news', 'privacy', 'policy', 'terms',
  'get', 'in', 'touch', 'read', 'more', 'view', 'book', 'call', 'email', 'find', 'out', 'latest', 'careers', 'join', 'managing',
  'director', 'manager', 'head', 'partner', 'owner', 'founder', 'lettings', 'sales', 'property', 'properties', 'management',
  'estate', 'agents', 'limited', 'ltd', 'group', 'company', 'office', 'customer', 'client', 'clients', 'landlords', 'tenants',
  'and', 'of', 'for', 'with', 'all', 'rights', 'reserved', 'cookie', 'cookies', 'login', 'sign', 'register', 'welcome',
]);

function personName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length < 4 || t.length > 50) return null;
  const parts = t.split(' ');
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((p) => NOT_NAME_WORDS.has(p.toLowerCase()))) return null;
  return parts.every((p) => /^\p{Lu}[\p{L}\p{M}'.-]*$/u.test(p)) ? t : null;
}

/**
 * Names and roles from a team or about page, conservatively: schema.org Person entries (name + jobTitle) in JSON-LD
 * blocks, and "Name Surname, Role" / "Name Surname - Role" text where the role contains a decision-maker word.
 * The page is data only. At most 12 people.
 */
export function extractTeamMembers(html: unknown): SitePerson[] {
  if (typeof html !== 'string') return [];
  const page = html.slice(0, 600_000);
  const out: SitePerson[] = [];
  const add = (name: unknown, role: unknown) => {
    const n = personName(name);
    const r = cleanTitle(role);
    if (!n || !r || !ROLE_WORDS.test(r) || out.length >= 12) return;
    if (!out.some((p) => p.name.toLowerCase() === n.toLowerCase())) out.push({ name: n, role: r.slice(0, 60) });
  };
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node.slice(0, 50)) visit(n, depth + 1); return; }
    const o = node as Record<string, unknown>;
    if (o['@type'] === 'Person') add(o.name, o.jobTitle);
    for (const v of Object.values(o)) if (typeof v === 'object') visit(v, depth + 1);
  };
  for (const m of page.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]{1,50000}?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1]!), 0); } catch { /* not JSON: ignore */ }
  }
  const text = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&');
  for (const m of text.matchAll(/(?:^|\|)\s*([\p{Lu}][\p{L}'.-]+(?: [\p{Lu}][\p{L}'.-]+){1,3})\s*(?:,|-|–|\|)\s*\|*\s*([^|]{3,60})/gu)) {
    add(m[1], m[2]);
  }
  return out;
}

/** True when a named person (web or website) is one of the stored contacts: same surname and first initial. */
export function namedPersonIsStored(name: string, rows: ExistingContact[]): boolean {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return false;
  const l = nameKey(parts[parts.length - 1]);
  const f = nameKey(parts[0]);
  return rows.some((r) => nameKey(r.last_name) === l && nameKey(r.first_name)[0] === f[0]);
}

/** What one lead's Deep find did, for the summary. */
export interface LeadStats {
  hunterPeople: number;
  officersAdded: number;
  /** Emails filled in for contacts already on the lead (registry officers, typed people). */
  officerEmails: number;
  domainsShown: string[];
  domainsToCheck: number;
  namedByWeb: number;
  namedOnSite: number;
  hunterCapHit: boolean;
  aiCapHit: boolean;
  noHunterKey: boolean;
  noWebsite: boolean;
  failures: number;
  /** People Hunter lists on a domain that is not corroborated: shown to check, never stored. */
  unverifiedPeople: number;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sentenceDomain(d: string): string {
  return d.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
}

/** The plain-English summary stored on the lead's row. Only counts and cleaned domains are interpolated. */
export function deepFindSummary(s: LeadStats): string {
  const parts: string[] = [];
  const people = s.hunterPeople + s.officersAdded;
  if (people === 0 && s.officerEmails === 0) parts.push('No new people found.');
  else {
    const bits: string[] = [];
    if (s.hunterPeople > 0) bits.push(`${s.hunterPeople} from Hunter`);
    if (s.officersAdded > 0) bits.push(`${s.officersAdded} from Companies House`);
    if (people > 0) parts.push(`Found ${plural(people, 'new person', 'new people')} (${bits.join(', ')}).`);
    if (s.officerEmails > 0) parts.push(`Found ${plural(s.officerEmails, 'email', 'emails')} for people already on this lead.`);
  }
  const shown = s.domainsShown.map(sentenceDomain).filter(Boolean);
  if (shown.length > 0) parts.push(`Company domains: ${shown.join(', ')}.`);
  if (s.domainsToCheck > 0) parts.push(`${plural(s.domainsToCheck, 'more domain', 'more domains')} from a web search were searched but need checking.`);
  if (s.namedByWeb > 0) parts.push(`The web search named ${plural(s.namedByWeb, 'person', 'people')} not confirmed elsewhere: see suggestions.`);
  if (s.unverifiedPeople > 0) parts.push(`Hunter lists ${plural(s.unverifiedPeople, 'person', 'people')} on a domain that could not be confirmed as this company's: see suggestions.`);
  if (s.namedOnSite > 0) parts.push(`The website names ${plural(s.namedOnSite, 'person', 'people')} not found by Hunter or Companies House: see suggestions.`);
  if (s.noHunterKey) parts.push('No Hunter key is set for this organisation, so Hunter was skipped.');
  if (s.noWebsite) parts.push('This lead has no usable website.');
  if (s.hunterCapHit) parts.push('The Hunter credit cap was reached, so some searches were skipped.');
  if (s.aiCapHit) parts.push('The AI call cap was reached, so the web search was skipped.');
  if (s.failures > 0) parts.push(`${plural(s.failures, 'search', 'searches')} did not work this time.`);
  parts.push('New people are not added to follow-up sequences until you switch them on.');
  return parts.join(' ').slice(0, 1000);
}

/** What to do with a row left running by an interrupted tick: requeue once, then give up. */
export function stuckAction(row: { claimed_at: string | null; attempts: number }, now: Date): 'ignore' | 'requeue' | 'fail' {
  const claimed = row.claimed_at ? Date.parse(row.claimed_at) : NaN;
  if (Number.isFinite(claimed) && now.getTime() - claimed < STUCK_AFTER_MS) return 'ignore';
  return row.attempts >= 2 ? 'fail' : 'requeue';
}

/** A person Deep find looks up: a contact without an email, a registry officer, or a name already on the lead. */
export interface PersonToLookUp {
  first: string;
  last: string;
  title: string | null;
  source: 'contact' | 'officer' | 'owner';
  /** The existing contact row, when the person is already a contact. */
  contactId: string | null;
}

function titleWord(word: string): string {
  return word ? word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase()) : word;
}

/**
 * Reads a name written on the lead, such as "David John SIPPLE", "SIPPLE, David John" or "Deborah Garner (HR)",
 * into first name, surname and an optional role from the brackets. Null unless there are two plain name words.
 */
export function parseLeadPersonName(value: unknown): { first: string; last: string; title: string | null } | null {
  if (typeof value !== 'string') return null;
  let t = value.replace(/\s+/g, ' ').trim().slice(0, 120);
  let title: string | null = null;
  const role = /\(([^()]{1,60})\)\s*$/.exec(t);
  if (role) { title = cleanTitle(role[1]); t = t.slice(0, role.index).trim(); }
  t = t.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '');
  let first: string;
  let last: string;
  const comma = t.indexOf(',');
  if (comma > 0) {
    last = t.slice(0, comma).trim();
    first = t.slice(comma + 1).trim().split(' ')[0] ?? '';
  } else {
    const parts = t.split(' ');
    if (parts.length < 2) return null;
    first = parts[0]!;
    last = parts[parts.length - 1]!;
  }
  const f = cleanNamePart(first);
  const l = cleanNamePart(last);
  if (!f || !l || f.includes(' ') || l.length < 2) return null;
  if (title) title = title.charAt(0).toUpperCase() + title.slice(1);
  return { first: titleWord(f), last: titleWord(l), title };
}

/**
 * Everyone Deep find should look up, without repeats (same surname and an agreeing first name count as one person):
 * contacts that are people without an email (not removed), registry officers, then the lead's own owner name and its
 * additional owners. Existing contacts win, so a found email is filled into the existing row. People who already have
 * an email on the lead are never looked up again. At most 12.
 */
export function peopleToLookUp(
  lead: { owner_name?: unknown; additional_owners?: unknown },
  contacts: ExistingContact[],
  officers: { first_name: string | null; last_name: string | null; title: string | null }[],
): PersonToLookUp[] {
  const out: PersonToLookUp[] = [];
  const known = (first: string, last: string) => out.some((p) => nameKey(p.last) === nameKey(last) && firstAgrees(nameKey(p.first), nameKey(first)));
  const add = (p: PersonToLookUp) => { if (p.first && p.last && !known(p.first, p.last) && out.length < 12) out.push(p); };
  const withEmail = contacts.filter((c) => typeof c.email === 'string' && c.email.trim() !== '');
  const alreadyHasEmail = (first: string, last: string) => findSamePerson(withEmail, first, last) !== null;
  for (const c of contacts) {
    if (c.kind === 'general' || c.dismissed_at || (typeof c.email === 'string' && c.email.trim() !== '')) continue;
    const first = cleanNamePart(c.first_name);
    const last = cleanNamePart(c.last_name);
    if (first && last) add({ first, last, title: cleanTitle((c as { title?: unknown }).title), source: 'contact', contactId: c.id });
  }
  for (const o of officers) {
    if (o.first_name && o.last_name && !alreadyHasEmail(o.first_name, o.last_name)) {
      add({ first: o.first_name, last: o.last_name, title: o.title, source: 'officer', contactId: null });
    }
  }
  const owners = [lead.owner_name, ...(Array.isArray(lead.additional_owners) ? lead.additional_owners.slice(0, 10) : [])];
  for (const raw of owners) {
    const p = parseLeadPersonName(raw);
    if (p && !alreadyHasEmail(p.first, p.last)) add({ ...p, source: 'owner', contactId: null });
  }
  return out;
}
