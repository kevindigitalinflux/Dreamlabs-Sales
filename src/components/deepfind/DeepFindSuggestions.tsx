import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { foundRole, loadDeepFindReview, reviewNotice, saveDeepFindReview } from '../../lib/deepFindReview';
import type { ReviewState } from '../../lib/deepFindReview';
import { suggestionKey, visibleSuggestions } from '../../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewSuggestion } from '../../../supabase/functions/_shared/deepFindSuggestions';
import { SuggestionRows } from './SuggestionRows';
import { ReplacementRows } from './ReplacementRows';
import { groupReplacements, replaceNotice, replaceSavedEmail } from '../../lib/deepFindReplacements';
import { logDeepFindError } from '../../lib/deepFindErrors';
import { Heading } from './Heading';

/** Review actions always use the person's session and RLS, never an edge/service client. */
export function DeepFindSuggestions({ leadId, suggestions, refreshKey, roles = [], headingLevel = 3 }: { headingLevel?: number; leadId: string; suggestions: ReviewSuggestion[]; refreshKey: string; roles?: { name: string; role?: string | null }[] }) {
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

  async function act(s: ReviewSuggestion, action: 'add' | 'dismiss' | 'replace') {
    if (saving.current) return;
    saving.current = true;
    const key = suggestionKey(s);
    setBusy(true); setError(null); setHidden((keys) => [...keys, key]); setNotice('Saving…');
    // Focus remains on a stable status node when the optimistic row disappears.
    status.current?.focus();
    try {
      if (action === 'replace') setNotice(replaceNotice(await replaceSavedEmail(supabase, session?.user.id ?? null, leadId, s)));
      else setNotice(reviewNotice(await saveDeepFindReview(supabase, session?.user.id ?? null, leadId, s, action, roles), action, foundRole(s, roles)));
      try { setState(await loadDeepFindReview(supabase, leadId)); }
      catch (error: unknown) { logDeepFindError('deep find: saved review could not be refreshed', error); setError('Saved. Refresh to see the latest lead details.'); }
    } catch (error: unknown) {
      logDeepFindError('deep find: suggestion review could not be saved', error);
      setHidden((keys) => keys.filter((k) => k !== key));
      setNotice(''); setError('Could not save this change. Refresh and try again.');
    } finally { saving.current = false; setBusy(false); }
  }
  const shown = state ? visibleSuggestions(suggestions, state.lead, state.contacts).filter((s) => !hidden.includes(suggestionKey(s))) : [];
  const { groups, rest } = groupReplacements(shown);
  const replacements = shown.filter((s) => !rest.includes(s));
  return <section className="flex min-w-0 flex-col gap-2" aria-busy={busy}>
    <Heading level={headingLevel} className="font-heading text-sm font-bold">Suggestions to review</Heading>
    <p ref={status} tabIndex={-1} role="status" className="text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line">{notice || (state ? 'Possible details. Review before adding.' : 'Loading review details…')}</p>
    {groups.length > 0 && <div className="flex min-w-0 flex-col gap-2 rounded-xl border-2 border-red-500/40 bg-red-500/5 p-3">
      <Heading level={headingLevel + 1} className="font-heading text-sm font-bold">Saved addresses that do not exist</Heading>
      <p className="text-[13px]">We checked these saved addresses and the mail server says they do not exist. Replace them with a better guess, or leave them.</p>
      <ReplacementRows suggestions={replacements} busy={busy} onAction={(s, action) => void act(s, action)} />
    </div>}
    <SuggestionRows suggestions={rest} busy={busy} onAction={(s, action) => void act(s, action)} />
    {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
  </section>;
}
