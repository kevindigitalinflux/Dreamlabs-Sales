import { validateContactEdit } from '../../supabase/functions/_shared/contacts';
import type { ContactEditInput, ContactEditValue } from '../../supabase/functions/_shared/contacts';
import type { DecisionMakerCandidate } from '../types';

/** Raw text a contact form holds (every field is a string; empty means blank). */
export interface ContactFormValues {
  kind: 'person' | 'general';
  first_name: string;
  last_name: string;
  title: string;
  label: string;
  email: string;
  phone: string;
  linkedin_url: string;
}

/** Sources a signed-in user created; only these rows can be deleted. */
const OWN_SOURCES = ['manual', 'dream_agent'];

/** True for rows the user (or Dream Agent) made, as opposed to ones a provider search found. */
export function isOwnSource(source: string): boolean {
  return OWN_SOURCES.includes(source);
}

/** An empty form for a new contact of the given kind. */
export function emptyContactForm(kind: 'person' | 'general'): ContactFormValues {
  return { kind, first_name: '', last_name: '', title: '', label: '', email: '', phone: '', linkedin_url: '' };
}

/** Form values pre-filled from an existing contact. */
export function contactToForm(c: DecisionMakerCandidate): ContactFormValues {
  return {
    kind: c.kind,
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    title: c.title ?? '',
    label: c.label ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    linkedin_url: c.linkedin_url ?? '',
  };
}

/** Validates form text and returns the clean value, or a plain-English error. */
export function validateContactForm(
  form: ContactFormValues,
): { ok: true; value: ContactEditValue } | { ok: false; error: string } {
  const input: ContactEditInput = { ...form };
  return validateContactEdit(input);
}

/** Lowercased trimmed email for comparisons ('' when none). */
function normEmail(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/** Trimmed text for comparisons ('' when none). */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * How an edit is saved. Own rows (manual / Dream Agent) are edited in place. A
 * provider row (Hunter, Apollo, registries) is also edited in place EXCEPT when
 * the email changes (that re-keys the row so a later search would add the original
 * back) or, for a name-obfuscated row, when the name changes (the flag is not
 * client-editable); those are saved as a new manual contact and the provider row
 * is dismissed.
 */
export function editStrategy(
  contact: Pick<DecisionMakerCandidate, 'source' | 'email' | 'first_name' | 'last_name' | 'name_obfuscated'>,
  patch: Partial<Pick<ContactEditValue, 'email' | 'first_name' | 'last_name'>>,
): 'inline' | 'dismiss_and_insert' {
  if (isOwnSource(contact.source)) return 'inline';
  if (patch.email !== undefined && normEmail(patch.email) !== normEmail(contact.email)) return 'dismiss_and_insert';
  if (contact.name_obfuscated) {
    const nameChanged =
      (patch.first_name !== undefined && norm(patch.first_name) !== norm(contact.first_name)) ||
      (patch.last_name !== undefined && norm(patch.last_name) !== norm(contact.last_name));
    if (nameChanged) return 'dismiss_and_insert';
  }
  return 'inline';
}

/** Message shown after a provider row was replaced by the user's own copy. */
export const SAVED_AS_OWN_MESSAGE = 'Saved as your own contact so it is not replaced by a new search';

/** The Postgres / PostgREST error shape the Supabase client returns. */
export interface DbErrorLike {
  code?: string;
  message?: string;
  details?: string | null;
}

/**
 * Plain-English message for a failed contact write. Duplicate email and second
 * main contact (Postgres 23505, told apart by constraint name) and an RLS no-op
 * (PGRST116) each get their own wording; anything else falls back to the
 * database message.
 */
export function contactErrorMessage(err: DbErrorLike): string {
  const text = `${err.message ?? ''} ${err.details ?? ''}`;
  if (err.code === '23505') {
    if (text.includes('decision_maker_candidates_one_primary')) return 'This lead already has a main contact; pick one first';
    if (text.includes('decision_maker_candidates_lead_dedupe_key')) return 'That email is already on this lead';
    return 'That contact already exists on this lead';
  }
  if (err.code === 'PGRST116') return 'You do not have permission to change this contact.';
  return err.message || 'Something went wrong saving this contact. Please try again.';
}

/**
 * The writes needed to make `newId` the main contact: first clear every other live
 * primary (the database allows only one), then set the new one. `restore` lists the
 * ids to put back if the second step fails. A null `set` means nothing to do.
 */
export function primarySwitchPlan(
  contacts: Pick<DecisionMakerCandidate, 'id' | 'is_primary' | 'dismissed_at'>[],
  newId: string,
): { clear: string[]; set: string | null; restore: string[] } {
  const target = contacts.find((c) => c.id === newId);
  if (!target || (target.is_primary && !target.dismissed_at)) return { clear: [], set: null, restore: [] };
  const clear = contacts.filter((c) => c.is_primary && !c.dismissed_at && c.id !== newId).map((c) => c.id);
  return { clear, set: newId, restore: [...clear] };
}

/**
 * Row to insert for a new manual contact (or a replacement for a provider row):
 * the validated values, with the sequence setting chosen by the caller. The primary
 * flag is always false here; it is applied afterwards so the one-primary index is
 * never violated. Provider columns are left at their defaults.
 */
export function newContactRow(
  leadId: string,
  userId: string,
  value: ContactEditValue,
  includeInSequences = true,
): Record<string, unknown> {
  return { ...value, lead_id: leadId, source: 'manual', created_by: userId, include_in_sequences: includeInSequences, is_primary: false };
}
