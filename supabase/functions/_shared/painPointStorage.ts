import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { formatPainPointNote, resolvePainPoint, type ChosenPainPoint, type PainPointNote } from './painPointPick.ts';

/** Read the complete newest-first history, not a recency window that can hide a manual choice. */
export async function loadPainPointNotes(client: SupabaseClient, leadId: string): Promise<PainPointNote[]> {
  const rows: PainPointNote[] = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await client.from('lead_notes').select('content,note_type,edited_at')
      .eq('lead_id', leadId).order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + 999);
    if (error) throw new Error('Could not load pain point notes');
    rows.push(...(data ?? []) as PainPointNote[]);
    if ((data ?? []).length < 1000) return rows;
  }
}

/** Append an AI choice only; re-read manual precedence immediately before writing, never overwrite any note. */
export async function saveAiPainPoint(client: SupabaseClient, leadId: string, choice: ChosenPainPoint | null): Promise<ChosenPainPoint | null> {
  const current = resolvePainPoint(await loadPainPointNotes(client, leadId));
  if (current?.source === 'manual' || !choice || choice.source === 'manual') return current ?? choice;
  if (current?.pain_point === choice.pain_point && current.reason === choice.reason) return current;
  const { error } = await client.from('lead_notes').insert({ lead_id: leadId, created_by: null, note_type: 'ai_summary', content: formatPainPointNote(choice) });
  if (error) throw new Error('Could not save the AI pain point');
  return choice;
}

/** Store the existing Sonnet research note without adding an AI Main pain point over a manual choice. */
export async function saveGeneratedPainPointNotes(client: SupabaseClient, leadId: string, generated: string): Promise<string> {
  const manual = resolvePainPoint(await loadPainPointNotes(client, leadId))?.source === 'manual';
  const start = generated.indexOf('Talking points:');
  const content = manual ? (start >= 0 ? generated.slice(start) : 'Research saved; the manual pain point stays in use.') : generated;
  const { error } = await client.from('lead_notes').insert({ lead_id: leadId, created_by: null, note_type: 'ai_summary', content });
  if (error) throw new Error('Could not save the AI research note');
  return content;
}
