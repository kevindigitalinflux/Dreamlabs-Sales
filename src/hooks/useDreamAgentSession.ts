import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type { LeadPatch } from '../lib/leadUpdates';
import { sanitizeDreamAgentActions } from '../lib/dreamAgentActions';
import { useAuth } from './useAuth';
import { useOrg } from './useOrg';
import type { DreamAgentAction, DreamAgentUpdatePatch, Lead } from '../types';

export type ActionResolution =
  | { status: 'pending' }
  | { status: 'dismissed' }
  | { status: 'confirmed_update' }
  | { status: 'confirmed_create'; pipeline_id: string }
  | { status: 'confirmed_ambiguous_as_lead'; lead_id: string }
  | { status: 'confirmed_ambiguous_as_new'; business_name: string; pipeline_id: string };

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
  const [messages, setMessages] = useState<string[]>([]);
  const [actions, setActions] = useState<DreamAgentAction[]>([]);
  const [resolutions, setResolutions] = useState<Record<number, ActionResolution>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(async (text: string, matchPipelineId: string | null) => {
    if (!currentOrg || !text.trim()) return;
    setLoading(true);
    setError(null);
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
    const sanitized = sanitizeDreamAgentActions(result.actions, validIds);
    setMessages(nextMessages);
    setActions(sanitized);
    setResolutions(Object.fromEntries(sanitized.map((_, i) => [i, { status: 'pending' } as ActionResolution])));
  }, [currentOrg, messages]);

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
    if (patch.next_action_date) result.next_action_date = patch.next_action_date;
    if (patch.next_action_note) result.next_action_note = patch.next_action_note;
    return result;
  }

  const confirmAll = useCallback(async () => {
    if (!currentOrg || !session) return;
    setLoading(true);
    setError(null);
    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      const resolution = resolutions[i];
      if (!resolution || !resolution.status.startsWith('confirmed_')) continue;

      if (action.type === 'update' && resolution.status === 'confirmed_update') {
        const { data: before } = await supabase.from('leads').select('*').eq('id', action.lead_id).single();
        const err = await applyLeadUpdate(action.lead_id, patchToLeadPatch(action.patch), before as Lead | null, session.user.id);
        if (err) { setError(err); continue; }
        await supabase.from('lead_notes').insert({
          lead_id: action.lead_id, created_by: session.user.id, note_type: 'ai_summary',
          content: `Dream Agent: ${action.excerpt}\n\n${action.rationale}`,
        });
      }

      if (action.type === 'create' && resolution.status === 'confirmed_create') {
        const { data: newLead, error: insertErr } = await supabase.from('leads').insert({
          business_name: action.extracted.business_name, owner_name: action.extracted.owner_name,
          phone: action.extracted.phone, email: action.extracted.email, website: action.extracted.website,
          city: action.extracted.city, vertical: action.extracted.vertical, stage: 'new_lead',
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
    }
    setLoading(false);
    setActions([]);
    setResolutions({});
    setMessages([]);
  }, [actions, resolutions, currentOrg, session]);

  return { messages, actions, resolutions, loading, error, sendMessage, resolveAction, confirmAll };
}
