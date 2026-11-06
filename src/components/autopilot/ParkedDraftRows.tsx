import type {EmailLog} from '../../types';
import type {ResolvedRunLeadRow} from './RunLeadGroups';
import type {useReviewBatch} from '../../hooks/useReviewBatch';
import {Button} from '../ui/Button';
/** Full draft text remains visible before a parked row can be selected or released. */
export function ParkedDraftRows({rows,logs,review,onAction}:{rows:ResolvedRunLeadRow[];logs:Record<string,EmailLog>;review:ReturnType<typeof useReviewBatch>;onAction:(action:'release'|'discard',id?:string)=>void}) {
 return <ul className="flex min-w-0 flex-col gap-3">{rows.filter(r=>!review.done.has(r.id)).map(row=>{
  const log=logs[row.email_log_id??''];
  return <li key={row.id} className="min-w-0 rounded-xl border border-line bg-card p-3">
   <label className="flex min-h-11 items-center gap-2"><input type="checkbox" aria-label={`Select parked draft for ${row.lead?.business_name??row.lead_id}`} disabled={review.busy||!log} checked={review.selected.has(row.id)} onChange={()=>review.toggle(row.id)} />{row.lead?.business_name??'Lead'}</label>
   {log?<><p className="break-all text-sm">To: {log.to_email}</p><p className="break-words font-semibold">{log.subject}</p><p className="whitespace-pre-wrap break-words text-sm">{log.body}</p>
    {!!log.attachments?.length&&<p className="break-words text-sm">Attachments: {log.attachments.map(file=>file.name).join(', ')}</p>}
    <div className="mt-2 flex flex-wrap gap-2"><Button disabled={review.busy} onClick={()=>onAction('release',row.id)}>Release draft</Button><Button variant="secondary" disabled={review.busy} onClick={()=>onAction('discard',row.id)}>Discard draft</Button></div></>
    :<p className="text-sm text-muted">This draft is unavailable, changed, or belongs to another sender. Review the run row below.</p>}
   {review.errors[row.id]&&<p role="alert" className="text-sm text-danger">{review.errors[row.id]}</p>}
  </li>;
 })}</ul>;
}
