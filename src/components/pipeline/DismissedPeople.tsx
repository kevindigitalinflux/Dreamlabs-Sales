import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { dismissedContactsOf, type DismissedContact } from '../../lib/restoreDismissed';
import type { DecisionMakerCandidate } from '../../types';
import { RestorePersonButton } from './RestorePersonButton';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {restoreSelectedPerson} from '../../lib/dismissedPeopleBulk';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';

/**
 * The lead's dismissed people with a Restore button each. Shown only when there are any. `reloadKey` changes when the
 * live contacts change, so a fresh dismissal appears here and a restore leaves. After a restore, focus moves to the
 * heading (or to the helper line when the last one is gone) and "Restored <name>" is announced.
 */
export function DismissedPeople({ leadId, reloadKey, onRestored, helperRef }: { leadId: string; reloadKey: string; onRestored: () => void; helperRef: React.RefObject<HTMLParagraphElement | null> }) {
  const [list, setList] = useState<DismissedContact[]>([]);
  const [message, setMessage] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scopeRef=useRef(leadId);
  const review=useReviewBatch(list.map(p=>p.id));
  const visible=list.filter(p=>!review.done.has(p.id));
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');

  useEffect(() => {
    let active = true;
    if(scopeRef.current!==leadId){scopeRef.current=leadId;setList([]);review.reset();setMessage('');}
    setLoading(true);setError('');
    void (async()=>{try{
      const {data,error}=await supabase.from('decision_maker_candidates').select('*').eq('lead_id',leadId).not('dismissed_at','is',null).order('dismissed_at',{ascending:false});
      if(error)throw error;if(active)setList(dismissedContactsOf((data as DecisionMakerCandidate[])??[]));
    }catch(error){console.error('dismissed people load failed',error);if(active)setError('Could not load dismissed people. Refresh and try again.');}
    finally{if(active)setLoading(false);}})();
    return () => { active = false; };
  }, [leadId, reloadKey]);

  function handleRestored(id: string, msg: string) {
    const remaining = list.filter((p) => p.id !== id);
    setList(remaining);
    setMessage(msg);
    onRestored();
    window.setTimeout(() => (remaining.length > 0 ? headingRef.current : helperRef.current)?.focus(), 0);
  }
  async function restoreSelected() {
    if(!window.confirm('Restore selected dismissed people to this lead?'))return;
    const restored=new Set<string>();
    await review.run(visible,p=>p.id,async person=>{const error=await restoreSelectedPerson(supabase,person);if(!error)restored.add(person.id);return error;},'Restore');
    setList(previous=>previous.filter(p=>!restored.has(p.id)));
    if(restored.size){setMessage(`Restored ${restored.size} people.`);onRestored();window.setTimeout(()=>(visible.length>restored.size?headingRef.current:helperRef.current)?.focus(),0);}
  }

  return (
    <>
      <p role="status" className="sr-only">{message}</p>
      {loading&&<p role="status" className="text-sm text-muted">Loading dismissed people…</p>}
      {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
      {!visible.length&&review.summary&&<p role="status" className="text-sm">{review.summary}</p>}
      {visible.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface/50 p-3 text-offwhite" aria-labelledby={`dismissed-${leadId}`}>
          <h3 id={`dismissed-${leadId}`} ref={headingRef} tabIndex={-1} className="font-heading text-sm font-bold focus-visible:outline-2 focus-visible:outline-violet-line">Dismissed people ({visible.length})</h3>
          <ReviewBatchControls review={{...review,busy:review.busy||loading}} ids={visible.map(p=>p.id)} approveLabel="Restore selected" onApprove={()=>void restoreSelected()} />
          <ul className="flex flex-col gap-2">
            {visible.map((p) => (
              <li key={p.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <label className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label={`Select dismissed person ${p.name}`} disabled={review.busy||loading} checked={review.selected.has(p.id)} onChange={()=>review.toggle(p.id)} />Select</label>
                <span className="flex min-w-0 flex-col text-sm">
                  <span className="break-words font-semibold">{p.name}</span>
                  <span className="break-words text-[13px]">{[p.role, p.source].filter(Boolean).join(' · ')}</span>
                </span>
                <RestorePersonButton contactId={p.id} name={p.name} externalBusy={review.busy||loading} onRestored={(m) => handleRestored(p.id, m)} />
                {review.errors[p.id]&&<p role="alert" className="w-full text-sm text-danger">{review.errors[p.id]}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
