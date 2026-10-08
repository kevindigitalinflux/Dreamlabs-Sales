import { addContactRow, setPrimaryContact, updateContactRow } from './contactWrites';
import type { ContactWriteCtx } from './contactWrites';
import { draftChangesContact, draftToForm } from './dreamAgentContacts';
import type { ContactStep } from './dreamAgentContacts';
import type { DecisionMakerCandidate } from '../types';

/** What happened to one confirmed contact row. `warning` means it was saved but something small failed. */
export interface ContactStepResult {
  index: number;
  ok: boolean;
  /** Plain English: the reason it failed, or when ok, an optional note. */
  message?: string;
}

/**
 * Runs confirmed contact rows in the order given (see planContactSteps), through the
 * same writes the Contacts card uses, tagged source 'dream_agent'. Each row is
 * independent: a failure is reported for that row and the rest still run. `live` is
 * the lead's current contacts (read fresh just before applying); it is copied, then
 * kept up to date as rows are saved so make-main always clears the right old contact.
 * Nothing is written for a row that is not in `steps`.
 */
export async function applyContactSteps(
  base: Omit<ContactWriteCtx, 'source' | 'onRow' | 'onRemoved'>,
  steps: ContactStep[],
  live: Record<string, DecisionMakerCandidate[]>,
): Promise<ContactStepResult[]> {
  const working: Record<string, DecisionMakerCandidate[]> = {};
  for (const [k, v] of Object.entries(live)) working[k] = [...v];
  const ctx: ContactWriteCtx = {
    ...base,
    source: 'dream_agent',
    onRow: (row) => {
      const list = working[row.lead_id] ?? [];
      working[row.lead_id] = list.some((c) => c.id === row.id) ? list.map((c) => (c.id === row.id ? row : c)) : [...list, row];
    },
    onRemoved: (id) => {
      for (const k of Object.keys(working)) working[k] = working[k].filter((c) => c.id !== id);
    },
  };

  const results: ContactStepResult[] = [];
  for (const step of steps) {
    const current = working[step.leadId] ?? [];
    let savedId: string | null = null;
    let message: string | undefined;

    if (step.type === 'add') {
      const r = await addContactRow(ctx, step.leadId, draftToForm(step.kind, step.draft), step.draft.include_in_sequences);
      if (r.error || !r.row) { results.push({ index: step.index, ok: false, message: r.error ?? 'The contact could not be added.' }); continue; }
      savedId = r.row.id;
    } else {
      const contact = current.find((c) => c.id === step.contactId);
      if (!contact) { results.push({ index: step.index, ok: false, message: 'That contact is no longer on this lead.' }); continue; }
      savedId = contact.id;
      if (draftChangesContact(contact, step.draft)) {
        const r = await updateContactRow(ctx, contact, draftToForm(contact.kind, step.draft, contact.linkedin_url ?? ''));
        if (r.error) { results.push({ index: step.index, ok: false, message: r.error }); continue; }
        savedId = r.row?.id ?? contact.id;
        message = r.notice;
      }
    }

    if (step.makePrimary && savedId) {
      const p = await setPrimaryContact(ctx, working[step.leadId] ?? [], savedId);
      if (p.error) message = `Saved, but it could not be made the main contact: ${p.error}`;
    } else if (step.primaryDeclined) {
      message = 'Saved. Another contact on this lead was made the main one instead.';
    }
    results.push({ index: step.index, ok: true, message });
  }
  return results;
}
