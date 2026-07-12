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
  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) return error.message;
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
