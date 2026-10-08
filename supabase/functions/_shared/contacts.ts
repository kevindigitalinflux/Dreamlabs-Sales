// Pure contact model for a lead: people and general inboxes stored in
// `decision_maker_candidates`. Which contact is the main one, who a sequence
// writes to, and validation of a user's edit. No imports, so it runs in both
// Deno (edge functions) and Vitest.

// Seniority tiers: copied from `_shared/autopilotChoices.ts`. Keep both in sync.
const TIER_1 = /\b(owner|founder|co-founder|managing director|ceo|chief executive)\b/i;
const TIER_2 = /\bdirector\b/i;
const TIER_3 = /\b(head|manager)\b/i;
const DEMOTED = /\b(assistant|deputy|associate|account|non-executive|non executive)\b/i;
// Same email rule as `autopilotChoices.ts` (keep both in sync): no whitespace or
// <>,;: anywhere, a dotted domain, and a TLD of 2+ letters.
const PLAUSIBLE_EMAIL = /^[^\s@<>,;:]+@([^\s@<>,;:.]+\.)+[a-z]{2,}$/i;
const PHONE_CHARS = /^[0-9 +().-]+$/;
// https only, then a dotted host (no spaces, credentials or path chars), then anything without spaces.
const HTTPS_URL = /^https:\/\/[^\s/?#@]+\.[^\s/?#@]+([/?#]\S*)?$/i;

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

/** Empty or whitespace-only strings count as missing. */
function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Trimmed, lowercased email, or null when it is not a plausible address. */
function validEmail(value: string | null | undefined): string | null {
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
 * 3. a usable general inbox the user added themselves;
 * 4. the lead's own valid email (`contactId: null`);
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
  for (const c of contacts) {
    if (!isUsable(c)) continue;
    const rank = rankOf(c);
    if (rank >= 7) continue; // legacy rows are handled after the lead's own email
    if (!best || rank < best.rank) best = { contact: c, rank };
  }
  if (best) return { email: validEmail(best.contact.email) as string, contactId: best.contact.id };

  const own = validEmail(leadEmail);
  if (own) return { email: own, contactId: null };

  const legacy = contacts.find((c) => isUsable(c));
  return legacy ? { email: validEmail(legacy.email) as string, contactId: legacy.id } : null;
}

/**
 * Everyone a sequence writes to for a lead. Empty when the lead opted out.
 * Otherwise the usable contacts with `include_in_sequences`, de-duplicated by
 * lowercased email (a primary, then the higher-ranked contact, wins a duplicate;
 * the first wins a tie), the main contact first, the rest in input order.
 * Rule for the lead's own email: it is added (once) only when the lead has no
 * curated contact, meaning no usable contact other than migrated legacy rows
 * (so follow-ups go to the people the user chose), and it is not already
 * covered. `contactId` is null for the lead's own email and `name` is null there.
 */
export function sequenceRecipients(
  contacts: Contact[],
  leadEmail: string | null,
  optedOut: boolean,
): { email: string; contactId: string | null; name: string | null }[] {
  if (optedOut) return [];
  const usable = contacts.filter(isUsable);

  const winners = new Map<string, Contact>();
  for (const c of usable) {
    if (!c.include_in_sequences) continue;
    const email = validEmail(c.email) as string;
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
  const hasCurated = usable.some((c) => !isLegacyGeneral(c));
  if (own && !hasCurated && !out.some((r) => r.email === own)) {
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
