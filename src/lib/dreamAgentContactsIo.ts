import { supabase } from './supabase';
import { dismissDecisionMaker } from './dismissDecisionMaker';
import { applyContactSteps } from './dreamAgentContactApply';
import { contactDraftName, isContactAction, planContactSteps, selectApplicable } from './dreamAgentContacts';
import type { ContactDraft, ContactIndex } from './dreamAgentContacts';
import type { DecisionMakerCandidate, DreamAgentAction } from '../types';

const LEAD_CHUNK = 100;
const PAGE_SIZE = 1000;

/** Outcome of the contact rows of the last apply, in plain English. */
export interface ContactReport { failed: string[]; notes: string[] }

/**
 * Reads the live (not dismissed) contacts of the given leads with the signed-in
 * user's own session, so row-level security applies. Every requested lead gets an
 * entry (an empty list when it has none), so "no contacts" differs from "not loaded".
 * Pages through PostgREST's 1000-row cap. Returns null if any read fails.
 */
export async function fetchContacts(leadIds: string[]): Promise<ContactIndex | null> {
  const index: ContactIndex = {};
  for (const id of leadIds) index[id] = [];
  for (let i = 0; i < leadIds.length; i += LEAD_CHUNK) {
    const ids = leadIds.slice(i, i + LEAD_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase.from('decision_maker_candidates').select('*')
        .in('lead_id', ids).is('dismissed_at', null).order('created_at').order('id').range(from, from + PAGE_SIZE - 1);
      if (error) return null;
      const rows = (data as DecisionMakerCandidate[] | null) ?? [];
      for (const row of rows) (index[row.lead_id] ??= []).push(row);
      if (rows.length < PAGE_SIZE) break;
    }
  }
  return index;
}

/**
 * Applies the confirmed add_contact / update_contact rows. The affected leads'
 * contacts are read fresh; each row's CURRENT edited draft is re-validated (an AI
 * `invalid` flag does not matter once the user fixed the row, and a still-invalid or
 * duplicate row is skipped with a reason in the report); adds run before updates per
 * lead; each row succeeds or fails on its own. Nothing is written for unconfirmed rows.
 */
export async function applyConfirmedContacts(
  actions: DreamAgentAction[],
  resolutions: Record<number, { status: string; draft?: ContactDraft }>,
  userId: string,
): Promise<{ report: ContactReport; leadIds: string[] }> {
  const items = actions.flatMap((action, index) => {
    const draft = resolutions[index]?.status === 'confirmed_contact' ? resolutions[index].draft : undefined;
    return isContactAction(action) && draft ? [{ index, action, draft }] : [];
  });
  const report: ContactReport = { failed: [], notes: [] };
  if (items.length === 0) return { report, leadIds: [] };
  const leadIds = [...new Set(items.map((i) => i.action.lead_id))];
  const live = await fetchContacts(leadIds);
  if (!live) {
    report.failed.push('Contacts could not be saved because the current contacts could not be read. Please try again.');
    return { report, leadIds };
  }
  const { steps: inputs, skipped } = selectApplicable(items, live);
  for (const s of skipped) report.failed.push(`Skipped ${s.name}: ${s.reason}`);
  const steps = planContactSteps(inputs);
  const results = await applyContactSteps({ client: supabase, userId, dismiss: dismissDecisionMaker }, steps, live);
  for (const r of results) {
    const step = steps.find((x) => x.index === r.index);
    const name = step ? contactDraftName(step.kind, step.draft) : 'a contact';
    if (!r.ok) report.failed.push(`Could not save ${name}: ${r.message ?? 'something went wrong'}`);
    else if (r.message) report.notes.push(`${name}: ${r.message}`);
  }
  return { report, leadIds };
}
