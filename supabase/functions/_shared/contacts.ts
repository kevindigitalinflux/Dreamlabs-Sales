// Pure contact model for a lead: people and general inboxes stored in
// `decision_maker_candidates`. Which contact is the main one, who a sequence
// writes to, and validation of a user's edit. No imports, so it runs in both
// Deno (edge functions) and Vitest.

// Seniority tiers: copied from `_shared/autopilotChoices.ts`. Keep both in sync.
const TIER_1 = /\b(owner|founder|co-founder|managing director|ceo|chief executive)\b/i;
const TIER_2 = /\bdirector\b/i;
const TIER_3 = /\b(head|manager)\b/i;
const DEMOTED = /\b(assistant|deputy|associate|account|non-executive|non executive)\b/i;
// Same email rule as `autopilotChoices.ts` (keep both in sync): no whitespace, <>,;: or
// non-ASCII characters anywhere, a dotted domain, and a TLD of 2+ letters.
const PLAUSIBLE_EMAIL = /^[^\s@<>,;:\u0080-￿]+@([^\s@<>,;:.\u0080-￿]+\.)+[a-z]{2,}$/i;
const PHONE_CHARS = /^[0-9 +().-]+$/;
// https only, then a dotted host (no spaces, credentials or path chars), then anything without spaces.
const HTTPS_URL = /^https:\/\/[^\s/?#@]+\.[^\s/?#@]+([/?#]\S*)?$/i;

// Control characters (C0, DEL), the Unicode line/paragraph separators, bidi controls
// (which can disguise text) and zero-width characters (which hide differences).
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2060\ufeff]/;
const MIN_PHONE_DIGITS = 5;

const MAX_NAME = 80;
const MAX_TITLE = 120;
const MAX_LABEL = 80;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const MAX_URL = 300;

/** One contact on a lead: a named person or a general inbox such as 'Accounts'. */
export interface Contact {
  id: string;
  kind: 'person' | 'general';
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  label: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  include_in_sequences: boolean;
  dismissed_at: string | null;
  source?: string;
}

/**
 * Read-only fingerprints of the regexes shared with `_shared/autopilotChoices.ts`. A test
 * asserts both modules export identical values, so the copies cannot drift.
 */
export const CHOICE_REGEX_SOURCES = {
  tier1: `${TIER_1.source}/${TIER_1.flags}`,
  tier2: `${TIER_2.source}/${TIER_2.flags}`,
  tier3: `${TIER_3.source}/${TIER_3.flags}`,
  demoted: `${DEMOTED.source}/${DEMOTED.flags}`,
  plausibleEmail: `${PLAUSIBLE_EMAIL.source}/${PLAUSIBLE_EMAIL.flags}`,
} as const;

/** Empty or whitespace-only strings count as missing. */
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Trimmed, lowercased email, or null when it is not a plausible address. */
export function validEmail(value: string | null | undefined): string | null {
  const v = clean(value)?.toLowerCase() ?? null;
  return v && PLAUSIBLE_EMAIL.test(v) ? v : null;
}

/** Seniority tier of a job title: 1 (best) to 4 (everything else, demoted titles). */
function tierOf(title: string | null): number {
  const t = title ?? '';
  if (DEMOTED.test(t)) return 4;
  if (TIER_1.test(t)) return 1;
  if (TIER_2.test(t)) return 2;
  if (TIER_3.test(t)) return 3;
  return 4;
}

/**
 * NOTE: legacy detection is label/source based, so toggling include_in_sequences on
 * a manual general inbox changes its ranking. A dedicated marker column should
 * replace this later. Keep in sync with `autopilotChoices.ts`.
 *
 * A general row copied from the old "additional emails" list (label 'Additional
 * email') or a manual general row excluded from sequences. Such rows rank below
 * the lead's own email. Keep in sync with `autopilotChoices.ts`.
 */
function isLegacyGeneral(c: Contact): boolean {
  if (c.kind !== 'general') return false;
  if ((c.label ?? '').trim().toLowerCase() === 'additional email') return true;
  return c.source === 'manual' && c.include_in_sequences === false;
}

/**
 * Display name of a contact. A person is "first last" (falling back to the
 * label, then 'Unknown name'); a general contact is its label or 'General inbox'.
 */
export function contactDisplayName(c: Contact): string {
  if (c.kind === 'general') return clean(c.label) ?? 'General inbox';
  const full = [clean(c.first_name), clean(c.last_name)].filter(Boolean).join(' ');
  return full || clean(c.label) || 'Unknown name';
}

const PROVIDER_SOURCES = ['hunter', 'apollo', 'companies_house', 'cro'];

/**
 * A contact a provider search found that has not been switched on for sequences (migration 053 defaults
 * these to off). Nobody curated it, so for sequence recipients it neither counts as a deliberate choice
 * nor vetoes its address.
 */
function isUnadoptedProviderRow(c: Contact): boolean {
  return !c.include_in_sequences && c.source !== undefined && PROVIDER_SOURCES.includes(c.source);
}

/** True when the contact is not dismissed and has a plausible email address. */
export function isUsable(c: Contact): boolean {
  return c.dismissed_at == null && validEmail(c.email) !== null;
}

/**
 * Rank used to choose between contacts (lower is better): primary first, then
 * named people by seniority tier, then the user's own general inboxes, then
 * migrated legacy general rows.
 */
function rankOf(c: Contact): number {
  if (c.is_primary) return 0;
  if (c.kind === 'person') return tierOf(c.title);
  return isLegacyGeneral(c) ? 7 : 6;
}

/**
 * The main contact for a lead. Order of preference:
 * 1. the usable contact marked primary;
 * 2. the best-ranked usable person (seniority tiers, input order within a tier);
 * 3. the lead's own valid email (`contactId: null`);
 * 4. a usable general inbox the user added and did not mark primary (an unmarked
 *    general inbox never beats the lead's own email);
 * 5. a migrated legacy general row ('Additional email' or manual and excluded
 *    from sequences);
 * 6. null.
 * Emails come back trimmed and lowercased.
 */
export function mainContact(
  contacts: Contact[],
  leadEmail: string | null,
): { email: string; contactId: string | null } | null {
  let best: { contact: Contact; rank: number } | null = null;
  let curated: Contact | null = null;
  let legacy: Contact | null = null;
  for (const c of contacts) {
    if (!isUsable(c)) continue;
    const rank = rankOf(c);
    if (rank === 6) curated = curated ?? c;
    else if (rank === 7) legacy = legacy ?? c;
    else if (!best || rank < best.rank) best = { contact: c, rank };
  }
  if (best) return { email: validEmail(best.contact.email) as string, contactId: best.contact.id };

  const own = validEmail(leadEmail);
  if (own) return { email: own, contactId: null };

  const general = curated ?? legacy;
  return general ? { email: validEmail(general.email) as string, contactId: general.id } : null;
}

/**
 * Everyone a sequence writes to for a lead. Empty when the lead opted out.
 * Otherwise the usable contacts with `include_in_sequences`, de-duplicated by
 * lowercased email (a primary, then the higher-ranked contact, wins a duplicate;
 * the first wins a tie), the main contact first, the rest in input order.
 * Fallback: when no curated contact is included (all excluded, provider rows switched off, only
 * migrated legacy rows, or no contacts) the lead's own valid email is the single recipient
 * (`contactId: null`, `name: null`), added once, unless an excluded or dismissed row the caller
 * passed carries that same address (exclusion wins for that address only). So [] means the lead has
 * no valid email, its email is vetoed, or it opted out.
 * Exclusion wins: an address excluded (include_in_sequences false) or dismissed on
 * any contact the caller passes never receives mail through another contact or the lead's own
 * email. Dismissed rows only count when the caller passes them (check-sequences passes live rows
 * only, on purpose). A provider-found row that is simply switched off (the default) is not a
 * deliberate choice: it does not veto its address. Callers (check-sequences, task A6) MUST
 * surface 'no recipients' visibly when this is [] instead of stalling silently.
 */
export function sequenceRecipients(
  contacts: Contact[],
  leadEmail: string | null,
  optedOut: boolean,
): { email: string; contactId: string | null; name: string | null }[] {
  if (optedOut) return [];
  const usable = contacts.filter(isUsable);
  const excluded = new Set<string>();
  for (const c of contacts) {
    const e = validEmail(c.email);
    if (e && (c.dismissed_at != null || (!c.include_in_sequences && !isUnadoptedProviderRow(c)))) excluded.add(e);
  }

  const winners = new Map<string, Contact>();
  for (const c of usable) {
    if (!c.include_in_sequences) continue;
    const email = validEmail(c.email) as string;
    if (excluded.has(email)) continue;
    const held = winners.get(email);
    if (!held || rankOf(c) < rankOf(held)) winners.set(email, c);
  }
  const included = usable.filter((c) => winners.get(validEmail(c.email) as string) === c);

  const main = mainContact(usable, null)?.contactId ?? null;
  included.sort((a, b) => Number(b.id === main) - Number(a.id === main));
  const out: { email: string; contactId: string | null; name: string | null }[] = included.map((c) => ({
    email: validEmail(c.email) as string,
    contactId: c.id,
    name: contactDisplayName(c),
  }));

  const own = validEmail(leadEmail);
  // The lead's own email is the fallback whenever no curated contact is included (all excluded, provider rows
  // switched off, only migrated legacy rows, or no contacts), unless an excluded or dismissed row carries it.
  const hasIncludedCurated = included.some((c) => !isLegacyGeneral(c));
  if (own && !hasIncludedCurated && !excluded.has(own) && !out.some((r) => r.email === own)) {
    out.push({ email: own, contactId: null, name: null });
  }
  return out;
}

/** What a user may submit when adding or editing a contact. */
export interface ContactEditInput {
  kind?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  label?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
}

/** A contact edit that passed validation, trimmed and normalised. */
export interface ContactEditValue {
  kind: 'person' | 'general';
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  label: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
}

/**
 * Validates and normalises a user's contact edit: trims strings, lowercases the
 * email, turns empty strings into null, and checks lengths, email, phone
 * characters, https-only LinkedIn link, and that a person has a first or last
 * name and a general contact has a label. Errors are plain English.
 */
export function validateContactEdit(
  input: ContactEditInput,
): { ok: true; value: ContactEditValue } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (input.kind !== 'person' && input.kind !== 'general') {
    return fail('Choose whether this is a person or a general inbox.');
  }
  const kind = input.kind;
  const first = clean(input.first_name);
  const last = clean(input.last_name);
  const title = clean(input.title);
  const label = clean(input.label);
  const email = clean(input.email)?.toLowerCase() ?? null;
  const phone = clean(input.phone);
  const url = clean(input.linkedin_url);

  const texts: [string, string | null][] = [
    ['First name', first], ['Last name', last], ['Position', title], ['Label', label],
    ['Email', email], ['Phone', phone], ['The LinkedIn link', url],
  ];
  for (const [name, text] of texts) {
    if (text && CONTROL_CHARS.test(text)) return fail(`${name} cannot contain line breaks or other control characters.`);
  }

  if (kind === 'person' && !first && !last) return fail('Add a first or last name for this person.');
  if (kind === 'general' && !label) return fail('Add a label for this inbox, for example Accounts.');

  if (first && first.length > MAX_NAME) return fail(`First name must be ${MAX_NAME} characters or fewer.`);
  if (last && last.length > MAX_NAME) return fail(`Last name must be ${MAX_NAME} characters or fewer.`);
  if (title && title.length > MAX_TITLE) return fail(`Position must be ${MAX_TITLE} characters or fewer.`);
  if (label && label.length > MAX_LABEL) return fail(`Label must be ${MAX_LABEL} characters or fewer.`);
  if (email && email.length > MAX_EMAIL) return fail(`Email must be ${MAX_EMAIL} characters or fewer.`);
  if (phone && phone.length > MAX_PHONE) return fail(`Phone must be ${MAX_PHONE} characters or fewer.`);
  if (url && url.length > MAX_URL) return fail(`The LinkedIn link must be ${MAX_URL} characters or fewer.`);

  if (email && !PLAUSIBLE_EMAIL.test(email)) return fail('That email address does not look right.');
  if (phone && !PHONE_CHARS.test(phone)) return fail('Phone numbers can only contain digits, spaces and + ( ) - .');
  if (phone && phone.replace(/\D/g, '').length < MIN_PHONE_DIGITS) {
    return fail(`Phone numbers need at least ${MIN_PHONE_DIGITS} digits.`);
  }
  if (url && !HTTPS_URL.test(url)) {
    return fail('The LinkedIn link must start with https:// and include a website address.');
  }

  return {
    ok: true,
    value: {
      kind,
      first_name: kind === 'person' ? first : null,
      last_name: kind === 'person' ? last : null,
      title,
      label,
      email,
      phone,
      linkedin_url: url,
    },
  };
}

/** One of a lead's current contacts as shown to the Dream Agent prompt. `email` is null for a contact with no usable address. */
export interface PromptContact {
  id: string;
  name_or_label: string;
  title: string | null;
  email: string | null;
  kind: 'person' | 'general';
  is_primary: boolean;
}

/**
 * A lead's live (not dismissed) contacts in the compact shape the Dream Agent prompt
 * gets, so it can update a person instead of adding a duplicate. Contacts with a
 * usable email come first (the main contact first among them), then name-only
 * contacts such as registry officers; at most `cap`.
 */
export function promptContacts(contacts: Contact[], cap = 8): PromptContact[] {
  const live = contacts.filter((c) => c.dismissed_at == null);
  const rank = (c: Contact) => (isUsable(c) ? (c.is_primary ? 0 : 1) : 2);
  live.sort((a, b) => rank(a) - rank(b));
  return live.slice(0, Math.max(0, cap)).map((c) => ({
    id: c.id,
    name_or_label: contactDisplayName(c),
    title: clean(c.title),
    email: validEmail(c.email),
    kind: c.kind,
    is_primary: c.is_primary,
  }));
}
