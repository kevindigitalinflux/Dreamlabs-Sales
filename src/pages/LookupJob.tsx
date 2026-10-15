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
import { mergeAdditions, type AdditionalDetail } from '../lib/enrichmentGrouping';
import { saveLookupProposal } from '../lib/applyLookupProposal';
import { mapLookupJob, type LookupJobInput, type LookupRowInput } from '../lib/jobs/lookup';
import type { EnrichableField, EnrichmentResult, Lead } from '../types';

interface ResultRow extends LookupRowInput {
  id: string; lead_id: string; reason: string | null; lead: Lead | null;
  result: { proposed?: EnrichmentResult['proposed']; source?: EnrichmentResult['source']; steps?: string[]; stored?: number };
}
interface Snapshot { scope: string; job: LookupJobInput | null; rows: ResultRow[]; error: string | null }
const STATUS = { queued: 'Waiting', running: 'Looking up', done: 'Finished', failed: 'Could not finish', skipped: 'Skipped' };

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
  const [reviewing, setReviewing] = useState<{ scope: string; row: ResultRow } | null>(null);
  const [action, setAction] = useState<{ scope: string; error: string | null; busy: boolean }>({ scope, error: null, busy: false });
  const visible = snapshot?.scope === scope ? snapshot : null;
  const reviewRow = reviewing?.scope === scope ? reviewing.row : null;
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
      setSnapshot({ scope, job: jobReply.data as LookupJobInput | null, rows: (rowsReply.data ?? []) as unknown as ResultRow[], error: null });
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
  const reviewResults = useMemo<EnrichmentResult[]>(() => reviewRow ? [{
    lead_id: reviewRow.lead_id, proposed: reviewRow.result.proposed ?? {}, source: reviewRow.result.source ?? {},
  }] : [], [reviewRow]);
  const leadsById = useMemo(() => reviewRow?.lead ? { [reviewRow.lead_id]: reviewRow.lead } : {}, [reviewRow]);

  async function mark(rowId: string, newReview: 'applied' | 'dismissed'): Promise<boolean> {
    if (currentScope.current !== scope) return false;
    const { data, error } = await supabase.rpc('lookup_job_review', { lead_row: rowId, new_review: newReview });
    if (error) throw error;
    return data === true;
  }
  async function dismiss(row: ResultRow) {
    setAction({ scope, busy: true, error: null });
    try {
      if (!await mark(row.id, 'dismissed')) throw new Error('Review rejected');
      await load(); await refreshJobs();
      setAction({ scope, busy: false, error: null });
    } catch (err) {
      console.error('lookup results: dismiss failed', lookupErrorKind(err));
      setAction({ scope, busy: false, error: 'Could not dismiss these proposals. Refresh and try again.' });
    }
  }
  async function apply(patches: Record<string, Partial<Record<EnrichableField, string>>>, additions: Record<string, AdditionalDetail[]>) {
    if (!reviewRow || !reviewRow.lead || currentScope.current !== scope)
      return { applied: 0, failed: [{ leadId: reviewRow?.lead_id ?? '', error: 'This lead is no longer available.' }] };
    const row = reviewRow;
    const leadId = row.lead_id;
    let error: string | null;
    try {
      error = await saveLookupProposal(async () => {
        const { data: latest, error: readError } = await supabase.from('leads').select('*').eq('id', leadId).eq('org_id', orgId!).single();
        if (readError) throw readError;
        if (!latest || currentScope.current !== scope) return 'This lead is no longer available.';
        const fields = patches[leadId] ?? {};
        for (const field of Object.keys(fields) as EnrichableField[]) {
          if ((latest[field] ?? '') !== (row.lead?.[field] ?? '') && latest[field] !== fields[field])
            return 'These details changed while you were reviewing. Close this review and open it again.';
        }
        return applyLeadUpdate(leadId, { ...fields, ...mergeAdditions(latest as Lead, additions[leadId] ?? []) }, latest as Lead, session?.user.id);
      }, () => mark(row.id, 'applied'));
    } catch (err) {
      console.error('lookup results: apply failed', lookupErrorKind(err));
      error = 'Could not save these details. Refresh and try again.';
    }
    setAction({ scope, busy: false, error });
    await load(); await refreshJobs();
    if (!error && currentScope.current === scope) setReviewing(null);
    return { applied: error ? 0 : 1, failed: error ? [{ leadId, error }] : [] };
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
    {visible?.rows.map((row) => <section key={row.id} className="min-w-0 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="break-words text-lg font-semibold">{row.lead?.business_name ?? 'Lead unavailable'}</h2>
        <span className="text-sm">{STATUS[row.status]}</span>
      </div>
      {row.reason && <p className="mt-2 text-sm">{row.reason}</p>}
      <ul className="mt-2 flex flex-col gap-1 break-words text-sm">{(row.result.steps ?? []).map((step, i) => <li key={i}>{step}</li>)}</ul>
      {visible.job?.kind === 'enrich' && <>
        <dl className="mt-3 grid min-w-0 gap-2 text-sm">
          {Object.entries(row.result.proposed ?? {}).map(([field, value]) => <div key={field} className="min-w-0">
            <dt className="font-semibold">{field === 'owner_name' ? 'Owner' : field.charAt(0).toUpperCase() + field.slice(1)}</dt>
            <dd className="break-all">{value} <span className="text-muted">({row.result.source?.[field as EnrichableField] ?? 'Lookup'})</span></dd>
          </div>)}
        </dl>
        {row.review === 'pending' && row.lead && <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setReviewing({ scope, row })} disabled={busy}>Review and apply</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void dismiss(row)}>Dismiss</Button>
        </div>}
        {row.review === 'applied' && <p className="mt-2 text-sm">Applied</p>}
        {row.review === 'dismissed' && <p className="mt-2 text-sm">Dismissed</p>}
      </>}
      {row.lead && <Link to={`/pipeline/leads/${row.lead_id}`} className="mt-3 inline-block text-sm underline">{visible.job?.kind === 'decision_makers' ? 'Review people on the lead' : 'Open lead'}</Link>}
    </section>)}
    {reviewRow && <EnrichmentReview open results={reviewResults} leadsById={leadsById} onClose={() => setReviewing(null)} onApply={apply} />}
  </div>;
}
