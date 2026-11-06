import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { lookupErrorKind } from '../../supabase/functions/_shared/lookupJobRules';
import { supabase } from '../lib/supabase';
import { useOrg } from '../hooks/useOrg';
import { useAuth } from '../hooks/useAuth';
import { useJobs } from '../hooks/useJobs';
import { EnrichmentReview } from '../components/pipeline/EnrichmentReview';
import { Button } from '../components/ui/Button';
import { applyLeadUpdate } from '../lib/leadUpdates';
import type {AdditionalDetail} from '../lib/enrichmentGrouping';
import {lookupReviewReason,saveLookupReview,type LookupReviewRow} from '../lib/lookupReviewActions';
import {LookupResults} from '../components/jobs/LookupResults';
import { mapLookupJob, type LookupJobInput } from '../lib/jobs/lookup';
import type { EnrichableField, EnrichmentResult, Lead } from '../types';

type ResultRow=LookupReviewRow;
interface Snapshot { scope: string; job: LookupJobInput | null; rows: ResultRow[]; error: string | null }

export function LookupJob() {
  const { jobId } = useParams();
  const { currentOrg } = useOrg();
  const { session } = useAuth();
  const { refresh: refreshJobs, stop } = useJobs();
  const orgId = currentOrg?.id;
  const scope = `${orgId}:${jobId}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const request = useRef(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [reviewing, setReviewing] = useState<{ scope: string; rows: ResultRow[] } | null>(null);
  const [action, setAction] = useState<{ scope: string; error: string | null; busy: boolean }>({ scope, error: null, busy: false });
  const visible = snapshot?.scope === scope ? snapshot : null;
  const reviewRows = useMemo(()=>reviewing?.scope===scope?reviewing.rows:[],[reviewing,scope]);
  const busy = action.scope === scope && action.busy;
  const actionError = action.scope === scope ? action.error : null;

  const load = useCallback(async () => {
    if (!orgId || !jobId) return;
    const token = ++request.current;
    try {
      const [jobReply, rowsReply] = await Promise.all([
        supabase.from('lookup_jobs').select('*').eq('id', jobId).eq('org_id', orgId).maybeSingle(),
        supabase.from('lookup_job_leads').select('id, lead_id, status, reason, result, review, lead:leads(*)')
          .eq('job_id', jobId).eq('org_id', orgId).order('id').limit(50),
      ]);
      if (token !== request.current || currentScope.current !== scope) return;
      if (jobReply.error || rowsReply.error) throw jobReply.error ?? rowsReply.error;
      const job=jobReply.data as LookupJobInput|null;
      const rows=await Promise.all(((rowsReply.data??[]) as unknown as ResultRow[]).map(async row=>{
        let canEdit=false;
        if(job?.kind==='enrich'&&row.lead&&row.review==='pending'&&row.status==='done'){const access=await supabase.rpc('can_edit_lead',{target_lead:row.lead_id});canEdit=!access.error&&access.data===true;}
        return {...row,reviewReason:lookupReviewReason(row,job?.kind??'',canEdit)};
      }));
      if(token!==request.current||currentScope.current!==scope)return;
      setSnapshot({scope,job,rows,error:null});
    } catch (err) {
      console.error('lookup results: load failed', lookupErrorKind(err));
      if (token === request.current && currentScope.current === scope)
        setSnapshot({ scope, job: null, rows: [], error: 'Could not load this job. Try refreshing.' });
    }
  }, [orgId, jobId, scope]);
  useEffect(() => {
    void load();
    return () => { request.current++; };
  }, [load]);
  const ended = visible?.job?.status === 'completed' || visible?.job?.status === 'cancelled';
  useEffect(() => {
    if (ended) return;
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load, ended]);

  const item = visible?.job ? mapLookupJob(visible.job, visible.rows, visible.rows.map((r) => r.lead?.business_name ?? null), {
    userId: session?.user.id ?? null, isAdmin: currentOrg?.role === 'admin',
  }) : null;
  const reviewResults=useMemo<EnrichmentResult[]>(()=>reviewRows.map(row=>({lead_id:row.lead_id,proposed:row.result.proposed??{},source:row.result.source??{}})),[reviewRows]);
  const leadsById=useMemo(()=>Object.fromEntries(reviewRows.flatMap(row=>row.lead?[[row.lead_id,row.lead]]:[])),[reviewRows]);

  async function mark(rowId: string, newReview: 'applied' | 'dismissed'): Promise<boolean> {
    if (currentScope.current !== scope) return false;
    const { data, error } = await supabase.rpc('lookup_job_review', { lead_row: rowId, new_review: newReview });
    if (error) throw error;
    return data === true;
  }
  async function dismiss(row:ResultRow):Promise<string|null> {
    try {return await mark(row.id,'dismissed')?null:'Could not skip this proposal. It may have changed or permission was refused.';}
    catch(error){console.error('lookup results: dismiss failed',lookupErrorKind(error));return 'Could not skip these proposals. Refresh and try again.';}
  }
  async function refreshAfterReview() {
    try{await load();await refreshJobs();}
    catch(error){console.error('lookup results refresh failed',lookupErrorKind(error));if(currentScope.current===scope)setAction({scope,busy:false,error:'Saved review results could not be refreshed. Refresh this page.'});}
  }
  async function apply(patches: Record<string, Partial<Record<EnrichableField, string>>>, additions: Record<string, AdditionalDetail[]>) {
    const leadId=Object.keys(patches)[0]??Object.keys(additions)[0];
    const row=reviewRows.find(row=>row.lead_id===leadId);
    if(!row||currentScope.current!==scope)return {applied:0,failed:[{leadId:leadId??'',error:'This lead is no longer available.'}]};
    let error:string|null;
    try {error=await saveLookupReview(row,patches[leadId]??{},additions[leadId]??[],{
      current:()=>currentScope.current===scope,
      read:async()=>{const result=await supabase.from('leads').select('*').eq('id',leadId).eq('org_id',orgId!).single();if(result.error)throw result.error;return result.data as Lead|null;},
      write:(patch,before)=>applyLeadUpdate(leadId,patch,before,session?.user.id),
      mark:()=>mark(row.id,'applied'),
    });}catch(err){console.error('lookup results: apply failed',lookupErrorKind(err));error='Could not save these details. Refresh and try again.';}
    await refreshAfterReview();
    return {applied:error?0:1,failed:error?[{leadId,error}]:[]};
  }
  async function stopJob() {
    if (!item) return;
    setAction({ scope, busy: true, error: null });
    try { setAction({ scope, busy: false, error: await stop(item.id) }); await load(); }
    catch (err) { console.error('lookup results: stop failed', lookupErrorKind(err)); setAction({ scope, busy: false, error: 'Could not stop this job. Try again.' }); }
  }

  return <div className="flex min-w-0 flex-col gap-4">
    <Link to="/jobs" className="text-sm underline">Back to Jobs</Link>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="min-w-0 break-words text-2xl font-bold">{item?.title ?? 'Lookup results'}</h1>
      {item?.canStop && <Button variant="secondary" loading={busy} onClick={() => void stopJob()}>Stop job</Button>}
    </div>
    {!visible && <p role="status">Loading lookup results…</p>}
    {visible?.error && <p role="alert">{visible.error}</p>}
    {visible && !visible.error && !visible.job && <p>This job is unavailable or has been deleted.</p>}
    {item && <p role="status" className="text-sm">{item.detail}</p>}
    {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
    {visible?.job&&<LookupResults key={scope} rows={visible.rows} kind={visible.job.kind} busy={busy||reviewRows.length>0} onReview={rows=>setReviewing({scope,rows})} onDismiss={dismiss} onChanged={refreshAfterReview} />}
    {reviewRows.length>0&&<EnrichmentReview open results={reviewResults} leadsById={leadsById} onClose={()=>setReviewing(null)} onApply={apply}
      onDismiss={async leadId=>{const row=reviewRows.find(r=>r.lead_id===leadId);if(!row)return 'This lead is no longer available.';const error=await dismiss(row);await refreshAfterReview();return error;}} />}
  </div>;
}
