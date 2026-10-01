import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import type { LeadNote, NoteType } from '../types';

/** Notes for one lead, newest first. addNote('...', 'call') also bumps call_count. */
export function useLeadNotes(leadId: string) {
  const { session } = useAuth();
  const [notes, setNotes] = useState<LeadNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('lead_notes').select('*').eq('lead_id', leadId).order('created_at', { ascending: false });
    if (err) setError(err.message);
    else {
      setNotes(data as LeadNote[]);
      setError(null);
    }
    setLoading(false);
  }, [leadId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  /** Inserts a note; call notes also update the lead's call stats. Returns error or null. */
  const addNote = useCallback(
    async (content: string, noteType: NoteType): Promise<string | null> => {
      const { error: err } = await supabase.from('lead_notes').insert({
        lead_id: leadId,
        created_by: session?.user.id,
        content,
        note_type: noteType,
      });
      if (err) return err.message;
      if (noteType === 'call') {
        const { data: lead } = await supabase.from('leads').select('call_count').eq('id', leadId).single();
        await supabase
          .from('leads')
          .update({ call_count: ((lead as { call_count: number } | null)?.call_count ?? 0) + 1, last_contacted_at: new Date().toISOString() })
          .eq('id', leadId);
      }
      await refresh();
      return null;
    },
    [leadId, session, refresh],
  );

  /**
   * Changes a note's text and marks it edited. Returns an error message or null.
   * .select().single() turns a write RLS silently blocks (0 rows matched, e.g. a
   * view-only shared pipeline) into a real error instead of a fake success.
   */
  const updateNote = useCallback(
    async (noteId: string, content: string): Promise<string | null> => {
      const text = content.trim();
      if (!text) return 'A note can\'t be empty.';
      const { error: err } = await supabase
        .from('lead_notes').update({ content: text, edited_at: new Date().toISOString() }).eq('id', noteId).select().single();
      if (err) return err.code === 'PGRST116' ? 'You don\'t have permission to edit this note.' : err.message;
      await refresh();
      return null;
    },
    [refresh],
  );

  /**
   * Deletes a note. Returns an error message or null. A deleted call note also takes
   * one off the lead's call count, so a duplicate logged by mistake doesn't leave it inflated.
   */
  const deleteNote = useCallback(
    async (noteId: string): Promise<string | null> => {
      const note = notes.find((n) => n.id === noteId);
      // .select().single() so a delete RLS silently blocks is reported, not faked as success.
      const { error: err } = await supabase.from('lead_notes').delete().eq('id', noteId).select().single();
      if (err) return err.code === 'PGRST116' ? 'You don\'t have permission to delete this note.' : err.message;
      if (note?.note_type === 'call') {
        const { data: lead } = await supabase.from('leads').select('call_count').eq('id', leadId).single();
        const current = (lead as { call_count: number } | null)?.call_count ?? 0;
        if (current > 0) await supabase.from('leads').update({ call_count: current - 1 }).eq('id', leadId);
      }
      await refresh();
      return null;
    },
    [notes, leadId, refresh],
  );

  return { notes, loading, error, refresh, addNote, updateNote, deleteNote };
}
