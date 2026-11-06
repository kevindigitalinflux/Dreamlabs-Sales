import {Link} from 'react-router';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {selectedReviewRows} from '../../lib/reviewBatch';
import type {LookupReviewRow} from '../../lib/lookupReviewActions';
import type {EnrichableField} from '../../types';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';
import {Button} from '../ui/Button';
const STATUS={queued:'Waiting',running:'Looking up',done:'Finished',failed:'Could not finish',skipped:'Skipped'};
/** Selection opens the existing from/to review; skipping calls the same single-row review RPC. */
export function LookupResults({rows,kind,busy,onReview,onDismiss,onChanged}:{rows:LookupReviewRow[];kind:string;busy:boolean;
 onReview:(rows:LookupReviewRow[])=>void;onDismiss:(row:LookupReviewRow)=>Promise<string|null>;onChanged:()=>Promise<void>;
}) {
 const review=useReviewBatch(rows.filter(r=>!r.reviewReason).map(r=>r.id));
 const visible=rows.filter(r=>!review.done.has(r.id)&&!(kind==='enrich'&&['applied','dismissed'].includes(r.review)));
 async function skip(id?:string) {
  if(busy||!window.confirm('Skip the selected lookup proposals? No lead details will change.'))return;
  await review.run(visible,r=>r.id,onDismiss,'Skip',id?new Set([id]):review.selected);await onChanged();
 }
 const locked=busy||review.busy;
 return <>
  <ReviewBatchControls review={{...review,busy:locked}} ids={visible.filter(r=>!r.reviewReason).map(r=>r.id)} approveLabel="Apply selected" rejectLabel="Skip selected"
   onApprove={()=>onReview(selectedReviewRows(visible,review.selected,r=>r.id))} onReject={()=>void skip()} />
  {!visible.length&&<p className="text-sm text-muted">No lookup proposals waiting for review.</p>}
  {visible.map(row=><section key={row.id} className="min-w-0 rounded-lg border border-line bg-card p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-words text-lg font-semibold">{row.lead?.business_name??'Lead unavailable'}</h2><span className="text-sm">{STATUS[row.status]}</span></div>
   <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={`Select lookup proposals for ${row.lead?.business_name??row.lead_id}`} disabled={locked||!!row.reviewReason} checked={review.selected.has(row.id)} onChange={()=>review.toggle(row.id)} />Select proposals</label>
   {row.reviewReason&&<p className="text-sm text-muted">{row.reviewReason}</p>}
   {row.reason&&<p className="mt-2 text-sm">{row.reason}</p>}
   <ul className="mt-2 flex flex-col gap-1 break-words text-sm">{(row.result.steps??[]).map((step,i)=><li key={i}>{step}</li>)}</ul>
   {kind==='enrich'&&<>
    <dl className="mt-3 grid min-w-0 gap-2 text-sm">{Object.entries(row.result.proposed??{}).map(([field,value])=><div key={field} className="min-w-0"><dt className="font-semibold">{field==='owner_name'?'Owner':field.charAt(0).toUpperCase()+field.slice(1)}</dt><dd className="break-all">{value} <span className="text-muted">({row.result.source?.[field as EnrichableField]??'Lookup'})</span></dd></div>)}</dl>
    {row.review==='pending'&&<div className="mt-3 flex flex-wrap gap-2"><Button disabled={locked||!!row.reviewReason} onClick={()=>onReview([row])}>Review and apply</Button><Button variant="ghost" disabled={locked||!!row.reviewReason} onClick={()=>void skip(row.id)}>Skip</Button></div>}
   </>}
   {review.errors[row.id]&&<p role="alert" className="text-sm text-danger">{review.errors[row.id]}</p>}
   {row.lead&&<Link to={`/pipeline/leads/${row.lead_id}`} className="mt-3 inline-block text-sm underline">{kind==='decision_makers'?'Review people on the lead':'Open lead'}</Link>}
  </section>)}
 </>;
}
