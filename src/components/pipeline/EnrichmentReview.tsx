import { useEffect, useState } from 'react';
import type { AdditionalDetail } from '../../lib/enrichmentGrouping';
import type { EnrichableField, EnrichmentResult, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {applyEnrichmentRow} from '../../lib/enrichmentBulk';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';
import {EnrichmentFields} from './EnrichmentFields';
import {EnrichmentMode} from './EnrichmentMode';

interface EnrichmentReviewProps {
  open: boolean;
  results: EnrichmentResult[];
  leadsById: Record<string, Lead>;
  onClose: () => void;
  onDismiss?:(leadId:string)=>Promise<string|null>;
  /** `patches` are field writes (blank fields filled, or overwrites when "replace" is on);
   * `additions` are found values kept alongside what the lead already has, to be saved as a note. */
  onApply: (
    patches: Record<string, Partial<Record<EnrichableField, string>>>,
    additions: Record<string, AdditionalDetail[]>,
  ) => Promise<{ applied: number; failed: { leadId: string; error: string }[] }>;
}

/**
 * Review-before-apply diff panel for bulk enrichment — every proposed field
 * is individually checkable, checked by default; nothing writes until
 * Apply.
 */
export function EnrichmentReview({ open, results, leadsById, onClose, onApply,onDismiss }: EnrichmentReviewProps) {
  const [checked, setChecked] = useState<Record<string, Set<EnrichableField>>>({});
  const review=useReviewBatch(results.filter(r=>(checked[r.lead_id]?.size??0)>0).map(r=>r.lead_id));
  const visible=results.filter(r=>!review.done.has(r.lead_id));
  // Snapshot of each lead's pre-change field values, frozen at the moment
  // `results` arrives. Apply's realtime lead refresh can land before this
  // modal closes, and reading `leadsById` live for the "from" side would
  // then show a field's OLD and NEW value as identical once the real
  // update lands — the from→to diff would read "new@x.com → new@x.com".
  const [fromSnapshot, setFromSnapshot] = useState<Record<string, Partial<Record<EnrichableField, string>>>>({});
  // Off by default: enrichment enriches, it doesn't overwrite details a rep may
  // have got straight from the owner. Differing values are kept as a note instead.
  const [replaceExisting, setReplaceExisting] = useState(false);

  // EnrichmentReview stays mounted for the page's lifetime (Modal just
  // returns null while closed), so a one-time lazy useState initializer
  // would freeze `checked` at whatever `results` was on first mount ([]).
  // Re-derive it from `results` on every new run instead.
  useEffect(() => {
    const initial: Record<string, Set<EnrichableField>> = {};
    const snapshot: Record<string, Partial<Record<EnrichableField, string>>> = {};
    for (const r of results) {
      const fields = Object.keys(r.proposed) as EnrichableField[];
      initial[r.lead_id] = new Set(fields);
      const lead = leadsById[r.lead_id];
      const leadSnapshot: Partial<Record<EnrichableField, string>> = {};
      // '' (not '—') for "nothing there", so blank detection stays reliable; '—' is display-only.
      for (const field of fields) leadSnapshot[field] = (lead?.[field] as string | null) ?? '';
      snapshot[r.lead_id] = leadSnapshot;
    }
    setChecked(initial);
    setFromSnapshot(snapshot);
    setReplaceExisting(false);
    review.reset();
    // leadsById intentionally excluded — it changes on every realtime lead
    // update, and this snapshot must only be taken once per `results` run,
    // not re-taken every time the underlying leads refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results]);

  function toggle(leadId: string, field: EnrichableField) {
    setChecked((prev) => {
      const next = { ...prev };
      const fields = new Set(next[leadId]);
      if (fields.has(field)) fields.delete(field); else fields.add(field);
      next[leadId] = fields;
      return next;
    });
  }

  async function act(action:'apply'|'dismiss') {
    if(!window.confirm(action==='apply'?'Apply the selected leads using the checked fields and chosen fill rules?':'Dismiss selected details? No lead values will change.'))return;
    await review.run(visible,r=>r.lead_id,r=>action==='dismiss'?(onDismiss?.(r.lead_id)??Promise.resolve(null)):applyEnrichmentRow(r,checked,fromSnapshot,replaceExisting,onApply),action==='apply'?'Apply':'Dismiss');
  }

  return (
    <Modal open={open} onClose={()=>{if(!review.busy)onClose();}} title="Review found details">
      <div className="flex flex-col gap-4">
        {results.length === 0 && <p className="text-sm text-muted">Nothing found for the selected leads.</p>}
        <ReviewBatchControls review={review} ids={visible.filter(r=>(checked[r.lead_id]?.size??0)>0).map(r=>r.lead_id)} approveLabel="Apply selected" rejectLabel="Dismiss selected" onApprove={()=>void act('apply')} onReject={()=>void act('dismiss')} />
        {visible.map((r) => {
          const lead = leadsById[r.lead_id];
          return (
            <div key={r.lead_id} className="rounded-lg border border-line p-3">
              <label className="mb-2 flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" aria-label={`Select details for ${lead?.business_name??r.lead_id}`} disabled={review.busy||!checked[r.lead_id]?.size} checked={review.selected.has(r.lead_id)} onChange={()=>review.toggle(r.lead_id)} />{lead?.business_name??r.lead_id}</label>
              {!checked[r.lead_id]?.size&&<p className="text-xs text-muted">Select at least one field to apply this lead.</p>}
              {review.errors[r.lead_id]&&<p role="alert" className="text-sm text-danger">{review.errors[r.lead_id]}</p>}
              <EnrichmentFields r={r} name={lead?.business_name??r.lead_id} fromSnapshot={fromSnapshot} checked={checked} replaceExisting={replaceExisting} toggle={toggle} busy={review.busy} />
            </div>
          );
        })}
        {visible.length>0&&<EnrichmentMode replaceExisting={replaceExisting} setReplaceExisting={setReplaceExisting} busy={review.busy} />}
        <Button variant="ghost" disabled={review.busy} onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
