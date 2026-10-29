import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';
import { formatPainPointNote, resolvePainPoint, type PainPointNote } from '../../supabase/functions/_shared/painPointPick';
import { loadPainPointNotes } from '../../supabase/functions/_shared/painPointStorage';

/** Loads complete RLS-scoped pain-point history and appends explicit human choices to existing notes. */
export function usePainPoint(leadId: string, refreshKey?: unknown) {
  const { session } = useAuth();
  const [state, setState] = useState<{ leadId: string; notes: PainPointNote[]; error: string | null; loading: boolean }>({ leadId, notes: [], error: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setState({ leadId, notes: [], error: null, loading: true });
    void loadPainPointNotes(supabase, leadId).then(notes => {
      if (!cancelled) setState({ leadId, notes, loading: false, error: null });
    }).catch(() => {
      console.error('pain point: note history load failed');
      if (!cancelled) setState({ leadId, notes: [], loading: false, error: 'Could not load pain point notes. Reopen this screen to try again.' });
    });
    return () => { cancelled = true; };
  }, [leadId, refreshKey]);
  const save = useCallback(async (text: string): Promise<string | null> => {
    if (!session?.user.id) return 'Sign in before changing the pain point.';
    const value = text.replace(/\s+/g, ' ').trim();
    if (!value || value.length > 300) return 'Enter a pain point of 1 to 300 characters.';
    const content = formatPainPointNote({ pain_point: value, source: 'manual', reason: 'Chosen by you.' });
    try {
      const { error } = await supabase.from('lead_notes').insert({ lead_id: leadId, created_by: session.user.id, note_type: 'general', content }).select('id').single();
      if (error) throw new Error('Manual note was not saved');
      const notes = await loadPainPointNotes(supabase, leadId);
      setState({ leadId, notes, loading: false, error: null });
      return null;
    } catch (error) {
      console.error('pain point: manual note save or refresh failed');
      return 'Could not save or confirm the pain point. Reopen this screen to check before trying again.';
    }
  }, [leadId, session?.user.id]);
  const choice = useMemo(() => resolvePainPoint(state.leadId === leadId ? state.notes : []), [state, leadId]);
  return { choice, save, loading: state.leadId !== leadId || state.loading, error: state.leadId === leadId ? state.error : null };
}
