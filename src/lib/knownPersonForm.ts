import { validateContactEdit } from '../../supabase/functions/_shared/contacts';
import { cleanCompanyDomain } from '../../supabase/functions/_shared/knownPersonWide';
import type {
  DecisionMakerCandidate, KnownPersonInput, KnownPersonResult, KnownPersonSource, KnownPersonStep, KnownPersonSuggestion,
} from '../types';
import { contactToForm, editStrategy, isOwnSource } from './leadContacts';
import type { ContactFormValues } from './leadContacts';

/** Typed details for a known person, as raw form text. */
export interface KnownPersonText {
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  linkedin_url: string;
  /** Optional company website or email domain, when different from the lead's website. */
  company_domain?: string;
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
 * values trimmed, blanks left out, and `use_paid_lookups` sent only when it is off. An optional company domain is
 * cleaned to a bare hostname (scheme, path and www. removed) and refused when it is not one.
 */
export function buildKnownPersonPayload(text: KnownPersonText, usePaidLookups: boolean): Built<KnownPersonInput> {
  const { company_domain: typedDomain, ...fields } = text;
  const check = validateContactEdit({ kind: 'person', ...fields });
  if (!check.ok) return { ok: false, error: check.error };
  const v = check.value;
  const payload: KnownPersonInput = { first_name: v.first_name ?? '', last_name: v.last_name ?? '' };
  if (v.title) payload.title = v.title;
  if (v.email) payload.email = v.email;
  if (v.linkedin_url) payload.linkedin_url = v.linkedin_url;
  if (!usePaidLookups) payload.use_paid_lookups = false;
  if (typedDomain?.trim()) {
    const domain = cleanCompanyDomain(typedDomain);
    if (!domain) return { ok: false, error: 'Enter the company domain like loveliving.uk (or leave it blank).' };
    payload.company_domain = domain;
  }
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

const SOURCE_LABEL: Record<KnownPersonSource, string> = {
  hunter: 'Hunter', apollo: 'Apollo', pattern: 'Email pattern', website: 'Company website', you: 'You',
};

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
    // No source: it is "Search" only when the lookup reported finding exactly this value; otherwise it was already there.
    const reportedFound = !!result.found?.[key] && result.found[key]!.toLowerCase() === value.toLowerCase();
    const src = result.sources?.[key] ?? (reportedFound ? undefined : 'you');
    lines.push({ label, value, source: src ? (SOURCE_LABEL[src] ?? 'Search') : 'Search' });
  }
  // Older servers send no steps: fall back to the single "Hunter used. Apollo used." line.
  const steps = (result.steps ?? []).map(stepLine);
  const lookups = result.steps ? [] : [
    result.hunter_called ? 'Hunter used' : 'Hunter not used',
    result.apollo_called ? 'Apollo used' : 'Apollo not used',
  ];
  return { heading: `Saved ${personName(typed)}`, lines, steps, lookups, ...classifyMessages(result.errors, result.notes) };
}

/** True when the matched contact came from a search and is not set to receive follow-ups. */
export function needsFollowUpNotice(contact: Pick<DecisionMakerCandidate, 'source' | 'include_in_sequences'> | null | undefined): boolean {
  return !!contact && !isOwnSource(contact.source) && !contact.include_in_sequences;
}

/** How a step line looks: a tick for found, a dash otherwise; red for an error, muted for anything not found. */
export type StepTone = 'found' | 'muted' | 'error';

/** One lookup step as shown in the result panel. */
export interface StepLine { id: KnownPersonStep['id']; label: string; detail: string; tone: StepTone }

/** Maps a server step to its display line. Apollo being unavailable on a plan is muted, never an error. */
export function stepLine(step: KnownPersonStep): StepLine {
  const tone: StepTone = step.status === 'found' ? 'found' : step.status === 'error' ? 'error' : 'muted';
  return { id: step.id, label: step.label, detail: step.detail, tone };
}

/** Suggestions still worth offering: only for a field the saved person has left blank, one per value. */
export function visibleSuggestions(
  result: Pick<KnownPersonResult, 'suggestions'>,
  contact?: Pick<DecisionMakerCandidate, 'email' | 'linkedin_url'> | null,
): KnownPersonSuggestion[] {
  const seen = new Set<string>();
  return (result.suggestions ?? []).filter((s) => {
    const key = `${s.field}:${s.value.toLowerCase()}`;
    if (seen.has(key) || (contact && (contact[s.field] ?? '').trim() !== '')) return false;
    seen.add(key);
    return true;
  });
}

/** How "Use this" saves a suggestion through the normal contact edit path. */
export type SuggestionPlan =
  | { ok: false; error: string }
  | { ok: true; contact: DecisionMakerCandidate; form: ContactFormValues; switchOffAfter: boolean };

/**
 * Plans saving a suggestion onto the person: only into a blank field. For an email, follow-ups must stay off: an
 * edit that re-saves a provider row as a new contact copies `include_in_sequences` from the contact it is given,
 * so that copy is passed with it switched off; an in-place edit switches it off afterwards (`switchOffAfter`).
 */
export function planSuggestionUse(contact: DecisionMakerCandidate | null | undefined, s: KnownPersonSuggestion): SuggestionPlan {
  if (!contact) return { ok: false, error: 'This person could not be found. Reload the page and try again.' };
  if ((contact[s.field] ?? '').trim() !== '') {
    return { ok: false, error: s.field === 'email' ? 'This person already has an email, so the suggestion was not used.' : 'This person already has a LinkedIn link, so the suggestion was not used.' };
  }
  const form = { ...contactToForm(contact), [s.field]: s.value };
  if (s.field !== 'email') return { ok: true, contact, form, switchOffAfter: false };
  const inline = editStrategy(contact, { email: s.value }) === 'inline';
  return {
    ok: true, form,
    contact: { ...contact, include_in_sequences: false },
    switchOffAfter: inline && contact.include_in_sequences,
  };
}
