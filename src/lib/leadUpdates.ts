import { supabase } from './supabase';
import { stageInfo } from './utils';
import type { Lead } from '../types';

export type LeadPatch = Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'created_by'>>;

/**
 * Updates a lead row and auto-logs any stage change to lead_notes
 * (this is the pipeline's activity history). Returns an error message or null.
 */
export async function applyLeadUpdate(
  id: string,
  patch: LeadPatch,
  before: Lead | null,
  userId?: string,
): Promise<string | null> {
  // .select().single() is required, not cosmetic: a plain .update().eq() reports no
  // error when RLS silently blocks the write (0 rows matched, e.g. a view-only
  // shared pipeline) — the caller would think the edit succeeded when it never
  // persisted. Requesting the row back turns that silent no-op into a real error.
  const { error } = await supabase.from('leads').update(patch).eq('id', id).select().single();
  if (error) {
    // PGRST116 = "no rows returned" from .single() — RLS silently matched 0 rows
    // (e.g. a view-only shared pipeline), not a real database error.
    if (error.code === 'PGRST116') return 'You don\'t have permission to edit this lead.';
    console.error('Failed to update lead:', error);
    return 'Could not save this change. Please try again.';
  }
  if (patch.stage && before && patch.stage !== before.stage) {
    await supabase.from('lead_notes').insert({
      lead_id: id,
      created_by: userId ?? null,
      note_type: 'general',
      content: `Stage changed: ${stageInfo(before.stage).label} → ${stageInfo(patch.stage).label}`,
    });
  }
  return null;
}
