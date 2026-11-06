import type {useReviewBatch} from '../../hooks/useReviewBatch';
import {BulkActionBar} from './BulkActionBar';
/** Shared labelled controls; an empty selection stays visibly disabled. */
export function ReviewBatchControls({review,ids,approveLabel,rejectLabel,onApprove,onReject}:{
 review:ReturnType<typeof useReviewBatch>;ids:string[];approveLabel:string;rejectLabel?:string;onApprove:()=>void;onReject?:()=>void;
}) {
 return <div className="flex min-w-0 flex-col gap-2">
  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label="Select all actionable rows" disabled={review.busy||!ids.length}
   checked={ids.length>0&&ids.every(id=>review.selected.has(id))} onChange={review.all} />Select all actionable rows</label>
  <BulkActionBar showEmpty count={review.selected.size} busy={review.busy} approveLabel={approveLabel} rejectLabel={rejectLabel}
   onApprove={onApprove} onReject={onReject} onClear={review.clear} />
  <p className="text-xs text-muted">Up to 50 rows per action. Check each selected row before applying.</p>
  {review.summary&&<p role="status" className="text-sm">{review.summary}</p>}
 </div>;
}
