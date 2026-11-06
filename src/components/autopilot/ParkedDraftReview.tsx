import {useEffect,useState} from 'react';
import {supabase} from '../../lib/supabase';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {parkedDraftEligible,actOnParkedDraft} from '../../lib/parkedDraftActions';
import {discardReviewDraft,releaseReviewDraft,reviewedDraftMatches} from '../../lib/draftReviewActions';
import {finishParkedDraft} from '../../lib/finishParkedDraft';
import {enrollLead} from '../../lib/enrollLead';
import type {DraftLog} from '../../hooks/useDrafts';
import type {EmailLog,Lead} from '../../types';
import type {ResolvedRunLeadRow} from './RunLeadGroups';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';
import {ParkedDraftRows} from './ParkedDraftRows';
/** An explicit review surface for the run owner's parked drafts; never part of the general release queue. */
export function ParkedDraftReview({rows,userId,orgId,onChanged,blocked=false,onBusyChange}:{rows:ResolvedRunLeadRow[];userId:string;orgId:string;onChanged:()=>void;blocked?:boolean;onBusyChange?:(busy:boolean)=>void}) {
 const [logs,setLogs]=useState<Record<string,EmailLog>>({});const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const wanted=rows.filter(r=>r.status==='needs_input'&&r.resolution==='open');
 const ids=wanted.map(r=>r.email_log_id).filter(Boolean).sort().join(',');
 useEffect(()=>{
  let active=true;setLoading(true);setLogs({});setError('');
  void (async()=>{try {
   if(!ids){if(active)setLoading(false);return;}
   const {data,error}=await supabase.from('email_logs').select('*').in('id',ids.split(',')).eq('org_id',orgId).eq('sent_by',userId);
   if(error)throw error;
   if(active)setLogs(Object.fromEntries((data??[]).map(log=>[log.id,log as EmailLog])));
  }catch(error){console.error('parked drafts load failed',error);if(active)setError('Could not load parked drafts. Refresh and try again.');}
  finally{if(active)setLoading(false);}})();return()=>{active=false;};
 },[ids,orgId,userId]);
 const eligible=wanted.filter(row=>parkedDraftEligible(row,logs[row.email_log_id??''],userId,orgId));
 const review=useReviewBatch(eligible.map(r=>r.id));
 useEffect(()=>{onBusyChange?.(review.busy);},[review.busy,onBusyChange]);
 async function single(row:ResolvedRunLeadRow,action:'release'|'discard') {
  const [{data:log,error:logError},{data:lead,error:leadError}]=await Promise.all([
   supabase.from('email_logs').select('*').eq('id',row.email_log_id!).eq('org_id',orgId).maybeSingle(),
   supabase.from('leads').select('*').eq('id',row.lead_id).eq('org_id',orgId).maybeSingle(),
  ]);
  if(logError||leadError||!lead||!parkedDraftEligible(row,log as EmailLog|undefined,userId,orgId))return 'This draft changed or is no longer available. Refresh before trying again.';
  if(!reviewedDraftMatches(logs[row.email_log_id!] as DraftLog,log as DraftLog))return 'This parked draft changed after review. Refresh and review it again before sending or discarding.';
  return actOnParkedDraft(row,log as EmailLog,action,
   draft=>releaseReviewDraft(supabase,{...draft,lead:{id:lead.id,business_name:lead.business_name}} as DraftLog),
   id=>discardReviewDraft(supabase,id),
   sequenceId=>finishParkedDraft(lead as Lead,log as EmailLog,sequenceId,userId,(id,step)=>enrollLead(row.lead_id,id,userId,step)));
 }
 async function act(action:'release'|'discard',id?:string) {
  if(blocked||review.busy)return;
  if(!window.confirm(action==='release'?'Send these reviewed parked drafts now? Their usual follow-up sequence will continue.':'Discard these parked drafts?'))return;
  // A single-row button uses exactly the same row action; bulk uses the existing selection.
  await review.run(eligible,row=>row.id,row=>single(row,action),action==='release'?'Release':'Discard',id?new Set([id]):review.selected);onChanged();
 }
 if(!wanted.length&&!review.summary&&!review.busy)return null;
 return <section className="flex min-w-0 flex-col gap-3" aria-label="Review parked drafts">
  <h3 className="font-semibold">Parked drafts ready for review</h3>
  {loading&&<p role="status">Loading parked drafts…</p>}{error&&<p role="alert" className="text-danger">{error}</p>}
  <ReviewBatchControls review={{...review,busy:review.busy||blocked}} ids={eligible.filter(r=>!review.done.has(r.id)).map(r=>r.id)} approveLabel="Release selected" rejectLabel="Discard selected" onApprove={()=>void act('release')} onReject={()=>void act('discard')} />
  <ParkedDraftRows rows={wanted} logs={Object.fromEntries(eligible.map(r=>[r.email_log_id!,logs[r.email_log_id!]]))} review={{...review,busy:review.busy||blocked}} onAction={(action,id)=>void act(action,id)} />
  {Object.entries(review.errors).filter(([id])=>!wanted.some(r=>r.id===id)).map(([id,error])=><p key={id} role="alert" className="text-sm text-danger">{error}</p>)}
 </section>;
}
