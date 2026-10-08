import { validateContactEdit } from '../../supabase/functions/_shared/contacts';
import type { ContactEditInput } from '../../supabase/functions/_shared/contacts';
import type { ContactFormValues } from './leadContacts';
import type { DecisionMakerCandidate, DreamAgentAction, DreamAgentContactFields } from '../types';

/** The contacts of each lead the client holds (id of the lead -> its live contacts). */
export type ContactIndex = Record<string, DecisionMakerCandidate[]>;

/** Most contact actions kept for one lead, and in one batch. */
export const MAX_CONTACT_ACTIONS_PER_LEAD = 6;
export const MAX_CONTACT_ACTIONS_TOTAL = 20;
/** Label given to a general inbox the AI proposed without one. */
export const DEFAULT_GENERAL_LABEL = 'General inbox';

const MAX_TEXT_LEN = 500;
const TEXT_KEYS = ['first_name', 'last_name', 'title', 'label', 'email', 'phone'] as const;
type TextKey = (typeof TEXT_KEYS)[number];
const MARKUP = /[<>]/;

type AddAction = Extract<DreamAgentAction, { type: 'add_contact' }>;
type UpdateAction = Extract<DreamAgentAction, { type: 'update_contact' }>;
export type ContactAction = AddAction | UpdateAction;

/** True for the two contact action types. */
export function isContactAction(a: DreamAgentAction): a is ContactAction {
  return a.type === 'add_contact' || a.type === 'update_contact';
}

function text(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().slice(0, MAX_TEXT_LEN);
  return t === '' ? undefined : t;
}

function pickText(raw: unknown): DreamAgentContactFields {
  const out: DreamAgentContactFields = {};
  if (typeof raw !== 'object' || raw === null) return out;
  const r = raw as Record<string, unknown>;
  for (const key of TEXT_KEYS) {
    const v = text(r[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Plain-English reason when text carries markup characters, else null. Names are plain text. */
function markupProblem(f: Partial<Record<'first_name' | 'last_name' | 'title' | 'label', string>>): string | null {
  for (const key of ['first_name', 'last_name', 'title', 'label'] as const) {
    const v = f[key];
    if (v && MARKUP.test(v)) return 'Names, positions and labels must be plain text (no < or >).';
  }
  return null;
}

function toInput(kind: 'person' | 'general', f: DreamAgentContactFields): ContactEditInput {
  return { kind, first_name: f.first_name, last_name: f.last_name, title: f.title, label: f.label, email: f.email, phone: f.phone };
}

function same(a: string | null | undefined, b: string | undefined, lower = false): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  return lower ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Whitelists the add_contact / update_contact actions of one parse-session-notes
 * response. Call the returned function once per raw item, in order; it returns the
 * clean action or null (dropped). Rules:
 *  - lead_id must be in `validLeadIds`; an update's contact_id must be one of THAT lead's
 *    contacts in `index`, so a contact can never be moved to another lead;
 *  - only the six text keys, make_primary and include_in_sequences are read; anything else
 *    (source, created_by, ids for new rows, provider flags) is ignored;
 *  - the effective values go through validateContactEdit (plus a no-markup rule); a
 *    failure keeps the action but sets `invalid` to the reason, and it cannot be applied;
 *  - a general inbox without a label gets DEFAULT_GENERAL_LABEL;
 *  - at most 6 contact actions per lead and 20 in all; a second add with the same email
 *    on a lead, or an add for an email the lead already has, is dropped;
 *  - make_primary is kept for at most one contact per lead in the batch (the first).
 */
export function createContactSanitizer(validLeadIds: Set<string>, index: ContactIndex) {
  const perLead = new Map<string, number>();
  let total = 0;
  const seenEmail = new Set<string>();
  const primaryClaimed = new Set<string>();

  function room(leadId: string): boolean {
    return total < MAX_CONTACT_ACTIONS_TOTAL && (perLead.get(leadId) ?? 0) < MAX_CONTACT_ACTIONS_PER_LEAD;
  }
  function take(leadId: string) {
    total += 1;
    perLead.set(leadId, (perLead.get(leadId) ?? 0) + 1);
  }
  function claimPrimary(leadId: string, wanted: boolean, ok: boolean): boolean {
    if (!wanted || !ok || primaryClaimed.has(leadId)) return false;
    primaryClaimed.add(leadId);
    return true;
  }

  function sanitizeAdd(r: Record<string, unknown>, excerpt: string, rationale: string): AddAction | null {
    if (typeof r.lead_id !== 'string' || !validLeadIds.has(r.lead_id)) return null;
    if (r.kind !== 'person' && r.kind !== 'general') return null;
    const leadId = r.lead_id;
    if (!room(leadId)) return null;
    const kind = r.kind;
    const fields = pickText(r);
    if (kind === 'general') {
      delete fields.first_name;
      delete fields.last_name;
      if (!fields.label) fields.label = DEFAULT_GENERAL_LABEL;
    }
    const email = fields.email?.toLowerCase();
    const key = email ? `${leadId}|${email}` : null;
    if (key && seenEmail.has(key)) return null;
    if (email && (index[leadId] ?? []).some((c) => same(c.email, email, true))) return null;

    const problem = markupProblem(fields);
    const checked = problem ? { ok: false as const, error: problem } : validateContactEdit(toInput(kind, fields));
    const clean: DreamAgentContactFields = {};
    if (checked.ok) {
      for (const k of TEXT_KEYS) {
        const v = checked.value[k];
        if (v) clean[k] = v;
      }
    } else Object.assign(clean, fields);

    if (key) seenEmail.add(key);
    take(leadId);
    const action: AddAction = { type: 'add_contact', lead_id: leadId, kind, ...clean, excerpt, rationale };
    if (claimPrimary(leadId, r.make_primary === true, checked.ok)) action.make_primary = true;
    if (r.include_in_sequences === false) action.include_in_sequences = false;
    if (!checked.ok) action.invalid = checked.error;
    return action;
  }

  function sanitizeUpdate(r: Record<string, unknown>, excerpt: string, rationale: string): UpdateAction | null {
    if (typeof r.lead_id !== 'string' || !validLeadIds.has(r.lead_id)) return null;
    if (typeof r.contact_id !== 'string') return null;
    const leadId = r.lead_id;
    const existing = (index[leadId] ?? []).find((c) => c.id === r.contact_id);
    if (!existing) return null;
    if (!room(leadId)) return null;

    const rawPatch = typeof r.patch === 'object' && r.patch !== null ? (r.patch as Record<string, unknown>) : {};
    const picked = pickText(rawPatch);
    const patch: UpdateAction['patch'] = {};
    for (const k of TEXT_KEYS as readonly TextKey[]) {
      const v = picked[k];
      if (v === undefined) continue;
      if (existing.kind === 'general' && (k === 'first_name' || k === 'last_name')) continue;
      if (same(existing[k], v, k === 'email')) continue;
      patch[k] = k === 'email' ? v.toLowerCase() : v;
    }
    const wantsPrimary = rawPatch.make_primary === true && !existing.is_primary;
    if (Object.keys(patch).length === 0 && !wantsPrimary) return null;

    const effective: DreamAgentContactFields = {};
    for (const k of TEXT_KEYS) {
      const v = patch[k] ?? existing[k] ?? undefined;
      if (v) effective[k] = v;
    }
    let error: string | null = markupProblem(patch);
    if (!error) {
      const checked = validateContactEdit(toInput(existing.kind, effective));
      if (!checked.ok) error = checked.error;
    }
    const email = patch.email;
    if (!error && email) {
      const key = `${leadId}|${email}`;
      const taken = (index[leadId] ?? []).some((c) => c.id !== existing.id && same(c.email, email, true));
      if (taken || seenEmail.has(key)) error = 'That email is already on another contact of this lead.';
      else seenEmail.add(key);
    }

    take(leadId);
    const out: UpdateAction = { type: 'update_contact', lead_id: leadId, contact_id: existing.id, patch, excerpt, rationale };
    if (claimPrimary(leadId, wantsPrimary, error === null)) out.patch.make_primary = true;
    if (error) out.invalid = error;
    return out;
  }

  return (r: Record<string, unknown>): ContactAction | null => {
    const excerpt = text(r.excerpt) ?? '';
    const rationale = text(r.rationale) ?? '';
    return r.type === 'add_contact' ? sanitizeAdd(r, excerpt, rationale) : sanitizeUpdate(r, excerpt, rationale);
  };
}

/** What the user can edit on a contact row (every field is text; checkboxes are booleans). */
export interface ContactDraft {
  first_name: string; last_name: string; title: string; label: string; email: string; phone: string;
  make_primary: boolean; include_in_sequences: boolean;
}

/** The starting values of a row: an add's own fields, or an update's existing contact with the patch on top. */
export function draftFromAction(action: ContactAction, existing?: DecisionMakerCandidate): ContactDraft {
  if (action.type === 'add_contact') {
    return {
      first_name: action.first_name ?? '', last_name: action.last_name ?? '', title: action.title ?? '',
      label: action.label ?? '', email: action.email ?? '', phone: action.phone ?? '',
      make_primary: action.make_primary === true, include_in_sequences: action.include_in_sequences !== false,
    };
  }
  const p = action.patch;
  return {
    first_name: p.first_name ?? existing?.first_name ?? '', last_name: p.last_name ?? existing?.last_name ?? '',
    title: p.title ?? existing?.title ?? '', label: p.label ?? existing?.label ?? '',
    email: p.email ?? existing?.email ?? '', phone: p.phone ?? existing?.phone ?? '',
    make_primary: p.make_primary === true, include_in_sequences: existing?.include_in_sequences ?? true,
  };
}

/** Form values for the shared contact writes. `linkedin` keeps an existing link as it is. */
export function draftToForm(kind: 'person' | 'general', d: ContactDraft, linkedin = ''): ContactFormValues {
  return {
    kind, first_name: kind === 'person' ? d.first_name : '', last_name: kind === 'person' ? d.last_name : '',
    title: d.title, label: d.label, email: d.email, phone: d.phone, linkedin_url: linkedin,
  };
}

/** Shown when an email is already on another live contact of the lead. */
export const DUPLICATE_EMAIL_MESSAGE = 'That email is already on this lead';

/** True when another live contact (not `selfId`) of the lead already has this email, ignoring case. */
export function emailTaken(others: Pick<DecisionMakerCandidate, 'id' | 'email' | 'dismissed_at'>[], email: string, selfId?: string): boolean {
  const e = email.trim().toLowerCase();
  return e !== '' && others.some((c) => c.id !== selfId && c.dismissed_at == null && (c.email ?? '').trim().toLowerCase() === e);
}

/**
 * Plain-English problem with an edited row, or null when it can be applied. `others` is
 * the lead's other live contacts (leave out the contact being edited): an email one of
 * them already has is a problem.
 */
export function draftProblem(kind: 'person' | 'general', d: ContactDraft, others: Pick<DecisionMakerCandidate, 'id' | 'email' | 'dismissed_at'>[] = []): string | null {
  const markup = markupProblem(d);
  if (markup) return markup;
  const r = validateContactEdit({ kind, ...d, linkedin_url: '' });
  if (!r.ok) return r.error;
  return emailTaken(others, d.email) ? DUPLICATE_EMAIL_MESSAGE : null;
}

/** Display name for messages: the person's name, else the label, else the email. */
export function contactDraftName(kind: 'person' | 'general', d: ContactDraft): string {
  const person = [d.first_name, d.last_name].filter(Boolean).join(' ');
  return (kind === 'person' ? person : d.label) || d.email || 'a contact';
}

/** Lead ids that raw (unsanitised) contact actions refer to, limited to known leads. */
export function contactLeadIds(raw: unknown, validLeadIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if ((r.type === 'add_contact' || r.type === 'update_contact') && typeof r.lead_id === 'string' && validLeadIds.has(r.lead_id)) ids.add(r.lead_id);
  }
  return [...ids];
}

/** The raw action list without any contact action (used when the contacts could not be read). */
export function withoutContactActions(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.filter((item) => {
    const t = typeof item === 'object' && item !== null ? (item as Record<string, unknown>).type : undefined;
    return t !== 'add_contact' && t !== 'update_contact';
  });
}

/** True when saving the draft would change something on the contact (ignoring the main-contact flag). */
export function draftChangesContact(contact: DecisionMakerCandidate, d: ContactDraft): boolean {
  const names = contact.kind === 'person' && (!same(contact.first_name, d.first_name) || !same(contact.last_name, d.last_name));
  return names || !same(contact.title, d.title) || !same(contact.label, d.label)
    || !same(contact.email, d.email, true) || !same(contact.phone, d.phone);
}

/** One contact write to run, in order. */
export interface ContactStep {
  index: number;
  type: 'add' | 'update';
  leadId: string;
  contactId?: string;
  kind: 'person' | 'general';
  draft: ContactDraft;
  /** Make this contact the main one after saving it. */
  makePrimary: boolean;
  /** The user ticked main on another contact of this lead first, so this one is not made main. */
  primaryDeclined: boolean;
}

/** A confirmed row ready to be ordered by planContactSteps. */
export type ContactStepInput = Omit<ContactStep, 'makePrimary' | 'primaryDeclined'>;

/**
 * Orders confirmed contact rows for applying: leads in the order they first appear,
 * within a lead every add before every update, and rows keep their original order
 * otherwise. Only the first row that asks to be the main contact of a lead is made
 * main; later ones are saved but flagged `primaryDeclined`.
 */
export function planContactSteps(items: ContactStepInput[]): ContactStep[] {
  const leadOrder: string[] = [];
  for (const it of items) if (!leadOrder.includes(it.leadId)) leadOrder.push(it.leadId);
  const sorted = [...items].sort((a, b) => (
    leadOrder.indexOf(a.leadId) - leadOrder.indexOf(b.leadId)
    || Number(a.type === 'update') - Number(b.type === 'update')
    || a.index - b.index
  ));
  const claimed = new Set<string>();
  return sorted.map((it) => {
    const wants = it.draft.make_primary;
    const makePrimary = wants && !claimed.has(it.leadId);
    if (makePrimary) claimed.add(it.leadId);
    return { ...it, makePrimary, primaryDeclined: wants && !makePrimary };
  });
}

/** A confirmed row that was not written, and why (shown to the user). */
export interface SkippedContact { index: number; name: string; reason: string }

/**
 * Decides which confirmed contact rows can be applied, checking the CURRENT edited
 * draft (not what the AI first proposed) against the freshly read contacts: a row the
 * user fixed is applied, a row that is still invalid, whose contact has gone, or whose
 * email another contact already has, is skipped with a plain-English reason.
 */
export function selectApplicable(
  items: { index: number; action: ContactAction; draft: ContactDraft }[],
  live: ContactIndex,
): { steps: ContactStepInput[]; skipped: SkippedContact[] } {
  const steps: ContactStepInput[] = [];
  const skipped: SkippedContact[] = [];
  for (const { index, action, draft } of items) {
    const contacts = live[action.lead_id] ?? [];
    const existing = action.type === 'update_contact' ? contacts.find((c) => c.id === action.contact_id) : undefined;
    const kind = action.type === 'add_contact' ? action.kind : existing?.kind;
    if (!kind) { skipped.push({ index, name: contactDraftName('person', draft), reason: 'That contact is no longer on this lead.' }); continue; }
    const reason = draftProblem(kind, draft, contacts.filter((c) => c.id !== existing?.id));
    if (reason) { skipped.push({ index, name: contactDraftName(kind, draft), reason }); continue; }
    steps.push({ index, type: action.type === 'add_contact' ? 'add' : 'update', leadId: action.lead_id, contactId: existing?.id, kind, draft });
  }
  return { steps, skipped };
}
