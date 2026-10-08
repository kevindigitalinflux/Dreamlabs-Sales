import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SAVED_AS_OWN_MESSAGE, contactErrorMessage, editStrategy, newContactRow, primarySwitchPlan, validateContactForm,
} from './leadContacts';
import type { ContactFormValues } from './leadContacts';
import type { DecisionMakerCandidate } from '../types';

const TABLE = 'decision_maker_candidates';

/** Result of a contact write: an error to show, or null (with an optional plain-English notice). `row` is the saved row when there is one. */
export interface ContactResult { error: string | null; notice?: string; row?: DecisionMakerCandidate }

/**
 * What the contact writes need, with no React in it. `onRow` is told about every
 * row that was saved (so a screen can keep its own copy fresh), `onRemoved` about a
 * row that is no longer live. `dismiss` removes a provider row (the caller passes
 * dismissDecisionMaker). `source` is 'manual' for the Contacts card and
 * 'dream_agent' when Dream Agent saves something the user confirmed.
 */
export interface ContactWriteCtx {
  client: SupabaseClient;
  userId: string | null;
  dismiss: (id: string) => Promise<string | null>;
  source?: 'manual' | 'dream_agent';
  onRow?: (row: DecisionMakerCandidate) => void;
  onRemoved?: (id: string) => void;
}

/** Updates columns on one row; returns the stored row or an error message. */
async function patchRow(ctx: ContactWriteCtx, id: string, patch: Record<string, unknown>) {
  const { data, error } = await ctx.client.from(TABLE).update(patch).eq('id', id).select().single();
  if (error) return { row: null, error: contactErrorMessage(error) };
  ctx.onRow?.(data as DecisionMakerCandidate);
  return { row: data as DecisionMakerCandidate, error: null };
}

async function insertRow(ctx: ContactWriteCtx, leadId: string, value: Parameters<typeof newContactRow>[2], include = true) {
  if (!ctx.userId) return { row: null, error: 'You need to be signed in to add a contact.' };
  const { data, error } = await ctx.client.from(TABLE)
    .insert(newContactRow(leadId, ctx.userId, value, include, ctx.source ?? 'manual')).select().single();
  if (error) return { row: null, error: contactErrorMessage(error) };
  ctx.onRow?.(data as DecisionMakerCandidate);
  return { row: data as DecisionMakerCandidate, error: null };
}

/** Adds a person or general inbox (not main; use setPrimaryContact afterwards). */
export async function addContactRow(ctx: ContactWriteCtx, leadId: string, form: ContactFormValues, include = true): Promise<ContactResult> {
  const v = validateContactForm(form);
  if (!v.ok) return { error: v.error };
  const made = await insertRow(ctx, leadId, v.value, include);
  return made.row ? { error: null, row: made.row } : { error: made.error };
}

/**
 * Sets the main contact: clears the old one first, restores it if setting the
 * new one fails. `contacts` is the lead's current live list.
 */
export async function setPrimaryContact(
  ctx: ContactWriteCtx,
  contacts: Pick<DecisionMakerCandidate, 'id' | 'is_primary' | 'dismissed_at'>[],
  id: string,
): Promise<ContactResult> {
  const plan = primarySwitchPlan(contacts, id);
  if (!plan.set) return { error: null };
  for (const oldId of plan.clear) {
    const r = await patchRow(ctx, oldId, { is_primary: false });
    if (r.error) return { error: r.error };
  }
  const r = await patchRow(ctx, plan.set, { is_primary: true });
  if (!r.error) return { error: null };
  let restoreFailed = false;
  for (const oldId of plan.restore) if ((await patchRow(ctx, oldId, { is_primary: true })).error) restoreFailed = true;
  return { error: restoreFailed
    ? `${r.error}. Your previous main contact could not be restored, so no contact is marked as main. Choose one again.`
    : `${r.error}. Your previous main contact was kept.` };
}

/** Saves an edit. Provider rows whose email (or obfuscated name) changes are dismissed and re-saved as a new contact. */
export async function updateContactRow(ctx: ContactWriteCtx, contact: DecisionMakerCandidate, form: ContactFormValues): Promise<ContactResult> {
  const v = validateContactForm(form, contact.linkedin_url);
  if (!v.ok) return { error: v.error };
  if (editStrategy(contact, v.value) === 'inline') {
    const r = await patchRow(ctx, contact.id, { ...v.value });
    return r.row ? { error: null, row: r.row } : { error: r.error };
  }
  const made = await insertRow(ctx, contact.lead_id, v.value, contact.include_in_sequences);
  if (made.error || !made.row) return { error: made.error };
  const dismissErr = await ctx.dismiss(contact.id);
  if (dismissErr) {
    const { error: delErr } = await ctx.client.from(TABLE).delete().eq('id', made.row.id);
    if (delErr) return { error: 'A duplicate contact may exist; refresh and delete the extra one' };
    ctx.onRemoved?.(made.row.id);
    return { error: dismissErr };
  }
  ctx.onRemoved?.(contact.id);
  if (contact.is_primary) {
    const p = await patchRow(ctx, made.row.id, { is_primary: true });
    if (p.error) return { error: null, notice: `${SAVED_AS_OWN_MESSAGE}. It could not be made the main contact: ${p.error}`, row: made.row };
  }
  return { error: null, notice: SAVED_AS_OWN_MESSAGE, row: made.row };
}
