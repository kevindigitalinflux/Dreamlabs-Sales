import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { dismissedContactsOf, type DismissedContact } from '../../lib/restoreDismissed';
import type { DecisionMakerCandidate } from '../../types';
import { RestorePersonButton } from './RestorePersonButton';

/**
 * The lead's dismissed people with a Restore button each. Shown only when there are any. `reloadKey` changes when the
 * live contacts change, so a fresh dismissal appears here and a restore leaves. After a restore, focus moves to the
 * heading (or to the helper line when the last one is gone) and "Restored <name>" is announced.
 */
export function DismissedPeople({ leadId, reloadKey, onRestored, helperRef }: { leadId: string; reloadKey: string; onRestored: () => void; helperRef: React.RefObject<HTMLParagraphElement | null> }) {
  const [list, setList] = useState<DismissedContact[]>([]);
  const [message, setMessage] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    setList([]); setMessage('');
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', leadId).not('dismissed_at', 'is', null).order('dismissed_at', { ascending: false })
      .then(({ data, error }) => { if (active && !error) setList(dismissedContactsOf((data as DecisionMakerCandidate[]) ?? [])); });
    return () => { active = false; };
  }, [leadId, reloadKey]);

  function handleRestored(id: string, msg: string) {
    const remaining = list.filter((p) => p.id !== id);
    setList(remaining);
    setMessage(msg);
    onRestored();
    window.setTimeout(() => (remaining.length > 0 ? headingRef.current : helperRef.current)?.focus(), 0);
  }

  return (
    <>
      <p role="status" className="sr-only">{message}</p>
      {list.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface/50 p-3 text-offwhite" aria-labelledby={`dismissed-${leadId}`}>
          <h3 id={`dismissed-${leadId}`} ref={headingRef} tabIndex={-1} className="font-heading text-sm font-bold focus-visible:outline-2 focus-visible:outline-violet-line">Dismissed people ({list.length})</h3>
          <ul className="flex flex-col gap-2">
            {list.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 flex-col text-sm">
                  <span className="break-words font-semibold">{p.name}</span>
                  <span className="break-words text-[13px]">{[p.role, p.source].filter(Boolean).join(' · ')}</span>
                </span>
                <RestorePersonButton contactId={p.id} name={p.name} onRestored={(m) => handleRestored(p.id, m)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
