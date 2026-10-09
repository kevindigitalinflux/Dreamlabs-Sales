import { validateContactEdit } from '../../supabase/functions/_shared/contacts';
import type { DecisionMakerCandidate, KnownPersonInput, KnownPersonResult, KnownPersonSource } from '../types';
import { isOwnSource } from './leadContacts';

/** Typed details for a known person, as raw form text. */
export interface KnownPersonText {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  linkedin_url: string;
}

export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Splits a full name into first and last name. Rule: the first word is the first
 * name and everything after it is the last name, so "Mary Jane van der Berg"
 * becomes "Mary" and "Jane van der Berg". The form lets the user correct this.
 * A single word is an error because both names are needed to find someone.
 */
export function splitFullName(full: string): Built<{ first_name: string; last_name: string }> {
  const tokens = full.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { ok: false, error: 'Enter the first and last name, for example Andrea Manning.' };
  return { ok: true, value: { first_name: tokens[0], last_name: tokens.slice(1).join(' ') } };
}

/**
 * Validates the typed details with the shared contact rules and builds the request:
 * values trimmed, blanks left out, and `use_paid_lookups` sent only when it is off.
 */
export function buildKnownPersonPayload(text: KnownPersonText, usePaidLookups: boolean): Built<KnownPersonInput> {
  const check = validateContactEdit({ kind: 'person', ...text });
  if (!check.ok) return { ok: false, error: check.error };
  const v = check.value;
  const payload: KnownPersonInput = { first_name: v.first_name ?? '', last_name: v.last_name ?? '' };
  if (v.title) payload.title = v.title;
  if (v.email) payload.email = v.email;
  if (v.linkedin_url) payload.linkedin_url = v.linkedin_url;
  if (!usePaidLookups) payload.use_paid_lookups = false;
  return { ok: true, value: payload };
}

/** Name boxes the user may have edited by hand; when present they win over the split. */
export interface NameOverride { first_name: string; last_name: string }

/** Preview of how a full name will be split, or null when it cannot be split yet. */
export function namePreview(fullName: string): string | null {
  const split = splitFullName(fullName);
  return split.ok ? `First name: ${split.value.first_name}, Last name: ${split.value.last_name}` : null;
}

/**
 * The names to send: the hand-edited first and last name when the user opened the
 * edit boxes, otherwise the split of the full name.
 */
export function resolveName(fullName: string, override: NameOverride | null): Built<NameOverride> {
  return override ? { ok: true, value: override } : splitFullName(fullName);
}

/** Builds the request from a single full-name box plus the other fields. */
export function buildFromFullName(
  fullName: string,
  rest: Omit<KnownPersonText, 'first_name' | 'last_name'>,
  usePaidLookups: boolean,
  override: NameOverride | null = null,
): Built<KnownPersonInput> {
  const split = resolveName(fullName, override);
  if (!split.ok) return split;
  return buildKnownPersonPayload({ ...rest, ...split.value }, usePaidLookups);
}

/** What to do with a phone number the user typed after the server saved the person. */
export type PhoneDecision = { action: 'save'; phone: string } | { action: 'skip' } | { action: 'note'; note: string };

/**
 * Decides whether the typed phone is saved on the person the server created. It is saved
 * only when the row has no phone yet; if a provider already filled a different one, the
 * provider's number stays and the user is told.
 */
export function decidePhoneSave(typedPhone: string, rowPhone: string | null | undefined): PhoneDecision {
  const typed = typedPhone.trim();
  if (!typed) return { action: 'skip' };
  const existing = (rowPhone ?? '').trim();
  if (!existing) return { action: 'save', phone: typed };
  if (existing === typed) return { action: 'skip' };
  return { action: 'note', note: `A search already found the phone number ${existing}, so the number you typed (${typed}) was not saved.` };
}

const SOURCE_LABEL: Record<KnownPersonSource, string> = { hunter: 'Hunter', apollo: 'Apollo', you: 'You' };

/** One value shown in the result, with who supplied it. */
export interface SummaryLine { label: string; value: string; source: string }

/** Display name for a person. */
export function personName(p: Pick<KnownPersonInput, 'first_name' | 'last_name'>): string {
  return `${p.first_name} ${p.last_name}`.trim();
}

/**
 * Splits messages into red errors and neutral notes: blanks and repeats are dropped,
 * and a note that repeats an error is shown only as the error.
 */
export function classifyMessages(errors: string[] | undefined, notes: string[] | undefined): { errors: string[]; notes: string[] } {
  const clean = (list: string[] | undefined) => [...new Set((list ?? []).map((m) => m.trim()).filter(Boolean))];
  const errs = clean(errors);
  return { errors: errs, notes: clean(notes).filter((n) => !errs.includes(n)) };
}

/**
 * Lines to show after a lookup: the saved name, each value with its source label
 * ('Hunter', 'Apollo', 'You'), which paid lookups ran, and the sorted messages.
 */
export function summariseKnownPerson(
  result: KnownPersonResult,
  typed: KnownPersonInput,
  contact?: Pick<DecisionMakerCandidate, 'title' | 'email' | 'phone' | 'linkedin_url'> | null,
  typedPhone?: string,
) {
  const fields: [keyof KnownPersonResult['found'], string, string | undefined][] = [
    ['email', 'Email', typed.email], ['phone', 'Phone', typedPhone?.trim() || undefined], ['linkedin_url', 'LinkedIn', typed.linkedin_url],
  ];
  const lines: SummaryLine[] = [];
  const position = contact?.title || typed.title;
  if (position) lines.push({ label: 'Position', value: position, source: SOURCE_LABEL.you });
  for (const [key, label, typedValue] of fields) {
    // The saved row is the truth when we have it; otherwise what the server reported, then what was typed.
    const value = contact?.[key] || result.found?.[key] || typedValue;
    if (!value) continue;
    const src = result.sources?.[key] ?? (value === typedValue ? 'you' : undefined);
    lines.push({ label, value, source: src ? SOURCE_LABEL[src] : 'Search' });
  }
  const lookups = [
    result.hunter_called ? 'Hunter used' : 'Hunter not used',
    result.apollo_called ? 'Apollo used' : 'Apollo not used',
  ];
  return { heading: `Saved ${personName(typed)}`, lines, lookups, ...classifyMessages(result.errors, result.notes) };
}

/** True when the matched contact came from a search and is not set to receive follow-ups. */
export function needsFollowUpNotice(contact: Pick<DecisionMakerCandidate, 'source' | 'include_in_sequences'> | null | undefined): boolean {
  return !!contact && !isOwnSource(contact.source) && !contact.include_in_sequences;
}
