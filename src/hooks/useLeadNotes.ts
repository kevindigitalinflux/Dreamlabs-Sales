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

  return { notes, loading, error, refresh, addNote };
}
