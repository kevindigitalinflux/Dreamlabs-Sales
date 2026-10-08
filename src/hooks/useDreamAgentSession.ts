import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { sanitizeDreamAgentActions, splitContactPatch } from '../lib/dreamAgentActions';
import { mergeAdditions } from '../lib/enrichmentGrouping';
import { dismissDecisionMaker } from '../lib/dismissDecisionMaker';
import { applyContactSteps } from '../lib/dreamAgentContactApply';
import { isContactAction, planContactSteps } from '../lib/dreamAgentContacts';
import type { ContactDraft, ContactIndex } from '../lib/dreamAgentContacts';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import { useOrgPackages } from './useOrgPackages';
import { useIcps } from './useIcps';
import { usePersistedState } from './usePersistedState';
import type { DecisionMakerCandidate, DreamAgentAction, DreamAgentUpdatePatch, Lead } from '../types';

const NO_MESSAGES: string[] = [];
const NO_ACTIONS: DreamAgentAction[] = [];
const NO_RESOLUTIONS: Record<number, ActionResolution> = {};
const LEAD_CHUNK = 100;

/** Outcome of the contact rows of the last apply, in plain English. */
export interface ContactReport { failed: string[]; notes: string[] }
const NO_REPORT: ContactReport = { failed: [], notes: [] };

/** Reads the live (not dismissed) contacts of the given leads with the caller's own session, so row-level security applies. */
async function fetchContacts(leadIds: string[]): Promise<ContactIndex | null> {
  const index: ContactIndex = {};
  for (let i = 0; i < leadIds.length; i += LEAD_CHUNK) {
    const { data, error } = await supabase.from('decision_maker_candidates').select('*')
      .in('lead_id', leadIds.slice(i, i + LEAD_CHUNK)).is('dismissed_at', null).order('created_at');
    if (error) return null;
    for (const row of (data as DecisionMakerCandidate[] | null) ?? []) (index[row.lead_id] ??= []).push(row);
  }
  return index;
}

function draftName(kind: 'person' | 'general', d: ContactDraft): string {
  const person = [d.first_name, d.last_name].filter(Boolean).join(' ');
  return (kind === 'person' ? person : d.label) || d.email || 'a contact';
}

export type ActionResolution =
  | { status: 'pending' }
  | { status: 'dismissed' }
  | { status: 'confirmed_update' }
  | { status: 'confirmed_create'; pipeline_id: string }
  | { status: 'confirmed_ambiguous_as_lead'; lead_id: string }
  | { status: 'confirmed_ambiguous_as_new'; business_name: string; pipeline_id: string }
  | { status: 'confirmed_update_company_context'; edited_context: string }
  /** An add_contact / update_contact row, with the values as the user left them in the row. */
  | { status: 'confirmed_contact'; draft: ContactDraft };

/**
 * Owns one Dream Agent conversation: the growing list of user messages (the
 * original note plus any free-text refinements), the AI's latest full action
 * list, and each action's per-row resolution state. Nothing here writes to the
 * database except confirmAll, and only for actions whose resolution status starts
 * with "confirmed_" — every other action is silently discarded, matching the
 * guardrail: nothing applies without an explicit confirm.
 */
export function useDreamAgentSession() {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const packages = useOrgPackages();
  const { icps } = useIcps();
  // Persisted per org so leaving the page (e.g. to look up a lead's name) and
  // coming back doesn't wipe the in-progress conversation or its proposed actions.
  const storageScope = currentOrg?.id ?? 'none';
  const [messages, setMessages] = usePersistedState<string[]>(`dream-agent:messages:${storageScope}`, NO_MESSAGES);
  const [actions, setActions] = usePersistedState<DreamAgentAction[]>(`dream-agent:actions:${storageScope}`, NO_ACTIONS);
  const [resolutions, setResolutions] = usePersistedState<Record<number, ActionResolution>>(`dream-agent:resolutions:${storageScope}`, NO_RESOLUTIONS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live contacts of the leads in play. Not persisted: it is re-read when the page returns to saved actions and again right before applying.
  const [contactIndex, setContactIndex] = useState<ContactIndex>({});
  const [contactReport, setContactReport] = useState<ContactReport>(NO_REPORT);
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (restoredFor.current === storageScope) return;
    restoredFor.current = storageScope;
    const ids = [...new Set(actions.filter(isContactAction).map((a) => a.lead_id))];
    if (ids.length === 0) return;
    void fetchContacts(ids).then((idx) => { if (idx) setContactIndex(idx); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageScope]);

  const sendMessage = useCallback(async (text: string, matchPipelineId: string | null) => {
    if (!currentOrg || !text.trim()) return;
    setLoading(true);
    setError(null);
    setContactReport(NO_REPORT);
    const nextMessages = [...messages, text.trim()];
    const { data, error: invokeErr } = await supabase.functions.invoke('parse-session-notes', {
      body: { org_id: currentOrg.id, pipeline_id: matchPipelineId, messages: nextMessages },
    });
    setLoading(false);
    if (invokeErr) { setError(invokeErr.message); return; }
    const result = data as { actions?: unknown; error?: string };
    if (result.error) { setError(result.error); return; }
    // sanitizeDreamAgentActions must validate against the lead index the AI was
    // actually given, not against its output — re-fetch that same RLS-scoped
    // index here rather than trusting any id the response happens to reference.
    let query = supabase.from('leads').select('id').eq('org_id', currentOrg.id);
    if (matchPipelineId) query = query.eq('pipeline_id', matchPipelineId);
    const { data: leadRows } = await query;
    const validIds = new Set((leadRows ?? []).map((l) => l.id as string));
    // Contacts: the function reads its own copy for the prompt; this client copy (same RLS) is what
    // the sanitizer checks contact ids against. If it cannot be read, no update_contact survives
    // (it needs the contact to exist); an add is still caught by the database's duplicate check.
    const idx = (await fetchContacts([...validIds])) ?? {};
    setContactIndex(idx);
    const sanitized = sanitizeDreamAgentActions(result.actions, validIds, packages.allowed, new Set(icps.map((p) => p.id)), idx);
    setMessages(nextMessages);
    setActions(sanitized);
    setResolutions(Object.fromEntries(sanitized.map((_, i) => [i, { status: 'pending' } as ActionResolution])));
  }, [currentOrg, messages, packages, icps]);

  const resolveAction = useCallback((index: number, resolution: ActionResolution) => {
    setResolutions((prev) => ({ ...prev, [index]: resolution }));
  }, []);

  // pain_point is display-only, same as SuggestionDiff's existing "info only" row —
  // there's no Lead column for it, and it's deliberately never written anywhere.
  function patchToLeadPatch(patch: DreamAgentUpdatePatch): LeadPatch {
    const result: LeadPatch = {};
    if (patch.stage) result.stage = patch.stage;
    if (patch.deal_value !== undefined) result.deal_value = patch.deal_value;
    if (patch.package_tier) result.package_tier = patch.package_tier;
    if (patch.icp_id) result.icp_id = patch.icp_id;
    if (patch.next_action_date) result.next_action_date = patch.next_action_date;
    if (patch.next_action_note) result.next_action_note = patch.next_action_note;
    return result;
  }

  /**
   * Applies the confirmed add_contact / update_contact rows, after the lead changes above. The affected
   * leads' contacts are read fresh first, adds run before updates per lead, and each row succeeds or
   * fails on its own. Rows that are invalid, or not confirmed, are never written.
   */
  const applyContacts = useCallback(async () => {
    if (!session) return;
    const items = actions.flatMap((action, index) => {
      const resolution = resolutions[index];
      if (!isContactAction(action) || action.invalid || resolution?.status !== 'confirmed_contact') return [];
      return [{ action, index, draft: resolution.draft }];
    });
    if (items.length === 0) return;
    const leadIds = [...new Set(items.map((i) => i.action.lead_id))];
    const live = await fetchContacts(leadIds);
    if (!live) { setContactReport({ failed: ['Contacts could not be saved because the current contacts could not be read. Please try again.'], notes: [] }); return; }
    const steps = planContactSteps(items.map(({ action, index, draft }) => {
      const kind = action.type === 'add_contact' ? action.kind : (live[action.lead_id] ?? []).find((c) => c.id === action.contact_id)?.kind ?? 'person';
      return { index, type: action.type === 'add_contact' ? 'add' as const : 'update' as const, leadId: action.lead_id, contactId: action.type === 'update_contact' ? action.contact_id : undefined, kind, draft };
    }));
    const results = await applyContactSteps({ client: supabase, userId: session.user.id, dismiss: dismissDecisionMaker }, steps, live);
    const report: ContactReport = { failed: [], notes: [] };
    for (const r of results) {
      const step = steps.find((x) => x.index === r.index);
      const name = step ? draftName(step.kind, step.draft) : 'a contact';
      if (!r.ok) report.failed.push(`Could not save ${name}: ${r.message ?? 'something went wrong'}`);
      else if (r.message) report.notes.push(`${name}: ${r.message}`);
    }
    setContactReport(report);
    const fresh = await fetchContacts(leadIds);
    if (fresh) setContactIndex((prev) => ({ ...prev, ...Object.fromEntries(leadIds.map((id) => [id, fresh[id] ?? []])) }));
  }, [actions, resolutions, session]);

  const confirmAll = useCallback(async () => {
    if (!currentOrg || !session) return;
    setLoading(true);
    setError(null);
    setContactReport(NO_REPORT);
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      const resolution = resolutions[i];
      if (!resolution || !resolution.status.startsWith('confirmed_')) continue;

      if (action.type === 'update' && resolution.status === 'confirmed_update') {
        const { data: before } = await supabase.from('leads').select('*').eq('id', action.lead_id).single();
        // Contact details from the note never overwrite: blanks are filled and a
        // differing email/phone/website/owner is kept in the lead's additional_* lists.
        const { fill, additions } = splitContactPatch(before as Lead | null ?? undefined, action.patch);
        const leadPatch: LeadPatch = { ...patchToLeadPatch(action.patch), ...fill, ...mergeAdditions(before as Lead | null ?? undefined, additions) };
        const err = await applyLeadUpdate(action.lead_id, leadPatch, before as Lead | null, session.user.id);
        if (err) { setError(err); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: action.lead_id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}\n\n${action.rationale}`,
        });
      }

      if (action.type === 'create' && resolution.status === 'confirmed_create') {
        // Apply what the rep said happened (e.g. visited → contacted, a follow-up
        // date) at creation — a new lead has no "before" row for applyLeadUpdate.
        const stage = action.patch.stage ?? 'new_lead';
        const { data: newLead, error: insertErr } = await supabase.from('leads').insert({
          business_name: action.extracted.business_name, owner_name: action.extracted.owner_name,
          phone: action.extracted.phone, email: action.extracted.email, website: action.extracted.website,
          city: action.extracted.city, vertical: action.extracted.vertical,
          address: action.extracted.address ?? null, postcode: action.extracted.postcode ?? null, stage,
          package_tier: action.patch.package_tier ?? null, deal_value: action.patch.deal_value ?? null,
          icp_id: action.patch.icp_id ?? null,
          next_action_date: action.patch.next_action_date ?? null, next_action_note: action.patch.next_action_note ?? null,
          last_contacted_at: stage !== 'new_lead' ? new Date().toISOString() : null,
          org_id: currentOrg.id, pipeline_id: resolution.pipeline_id, created_by: session.user.id,
        }).select('id').single();
        if (insertErr) { setError(insertErr.message); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: newLead.id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}\n\n${action.rationale}`,
        });
      }

      if (action.type === 'ambiguous' && resolution.status === 'confirmed_ambiguous_as_lead') {
        await supabase.from('lead_notes').insert({
          lead_id: resolution.lead_id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}`,
        });
      }

      if (action.type === 'ambiguous' && resolution.status === 'confirmed_ambiguous_as_new') {
        const { data: newLead, error: insertErr } = await supabase.from('leads').insert({
          business_name: resolution.business_name, stage: 'new_lead',
          org_id: currentOrg.id, pipeline_id: resolution.pipeline_id, created_by: session.user.id,
        }).select('id').single();
        if (insertErr) { setError(insertErr.message); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: newLead.id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}`,
        });
      }

      // RLS (organizations_admin_update_context) is the real gate here — only an
      // org admin can actually write this column. A non-admin's row is never
      // offered a way to reach this resolution status in the first place (see
      // ActionRow), but the write would cleanly fail via RLS either way.
      if (action.type === 'update_company_context' && resolution.status === 'confirmed_update_company_context') {
        const { error: updateErr } = await supabase.from('organizations')
          .update({ company_context: resolution.edited_context.trim() || null }).eq('id', currentOrg.id);
        if (updateErr) { setError(updateErr.message); continue; }
      }
    }
    await applyContacts();
    setLoading(false);
    setActions([]);
    setResolutions({});
    setMessages([]);
  }, [actions, resolutions, currentOrg, session, applyContacts]);

  return { messages, actions, resolutions, loading, error, contactIndex, contactReport, sendMessage, resolveAction, confirmAll };
}
