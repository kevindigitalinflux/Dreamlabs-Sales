import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { loadDeepFindReview, saveDeepFindReview } from '../../lib/deepFindReview';
import type { ReviewState } from '../../lib/deepFindReview';
import { suggestionKey, visibleSuggestions } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { SuggestionRows } from './SuggestionRows';
import { logDeepFindError } from '../../lib/deepFindErrors';

/** Review actions always use the person's session and RLS, never an edge/service client. */
export function DeepFindSuggestions({ leadId, suggestions, refreshKey, roles = [] }: { leadId: string; suggestions: ReviewSuggestion[]; refreshKey: string; roles?: { name: string; role?: string | null }[] }) {
  const { session } = useAuth();
  const [state, setState] = useState<ReviewState | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    void loadDeepFindReview(supabase, leadId).then((next) => {
      if (active) { setState(next); setError(null); }
    }).catch((error: unknown) => {
      logDeepFindError('deep find: review details could not be loaded', error);
      if (active) setError('Could not load review details. Refresh and try again.');
    });
    return () => { active = false; };
  }, [leadId, refreshKey]);

  async function act(s: ReviewSuggestion, action: 'add' | 'dismiss') {
    if (saving.current) return;
    saving.current = true;
    const key = suggestionKey(s);
    setBusy(true); setError(null); setHidden((keys) => [...keys, key]); setNotice('Saving…');
    // Focus remains on a stable status node when the optimistic row disappears.
    status.current?.focus();
    try {
      const result = await saveDeepFindReview(supabase, session?.user.id ?? null, leadId, s, action, roles);
      setNotice(result === 'none' ? 'Already on this lead' : result === 'owner_set' ? "Added to lead. Also set as the lead's owner." : action === 'add' ? 'Added to lead. No sequence enrolment was added.' : 'Dismissed.');
      try { setState(await loadDeepFindReview(supabase, leadId)); }
      catch (error: unknown) { logDeepFindError('deep find: saved review could not be refreshed', error); setError('Saved. Refresh to see the latest lead details.'); }
    } catch (error: unknown) {
      logDeepFindError('deep find: suggestion review could not be saved', error);
      setHidden((keys) => keys.filter((k) => k !== key));
      setNotice(''); setError('Could not save this change. Refresh and try again.');
    } finally { saving.current = false; setBusy(false); }
  }
  const shown = state ? visibleSuggestions(suggestions, state.lead, state.contacts).filter((s) => !hidden.includes(suggestionKey(s))) : [];
  return <div className="flex min-w-0 flex-col gap-2" aria-busy={busy}>
    <p ref={status} tabIndex={-1} role="status" className="text-xs text-muted focus:outline focus:outline-cyan">{notice || (state ? 'Possible details. Review before adding.' : 'Loading review details…')}</p>
    <SuggestionRows suggestions={shown} busy={busy} onAction={(s, action) => void act(s, action)} />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
