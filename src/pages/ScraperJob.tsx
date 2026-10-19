import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, XCircle, SkipForward } from 'lucide-react';
import { useScrapeJob } from '../hooks/useScrapeJob';
import { isScrapeJobFinished, isScrapeJobTimedOut } from '../lib/scrapeJobState';
import { useRawLeadActions } from '../hooks/useRawLeadActions';
import { supabase } from '../lib/supabase';
import { scrapeDeepFindLeadId } from '../lib/scrapeDeepFind';
import { DeepFindModal } from '../components/deepfind/DeepFindModal';
import { usePipeline } from '../hooks/usePipeline';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { SelectField } from '../components/ui/Input';
import { toCsv } from '../lib/csv';
import { SOURCE_NAMES } from '../lib/scrapeMerge';
import { readScrapeGroup } from '../../supabase/functions/_shared/scrapeGroup';
import { websiteHref } from '../lib/websiteHref';
import type { RawLead } from '../types';

function statusBadge(job: { status: string } | null) {
  if (!job) return null;
  const classes: Record<string, string> = {
    pending: 'bg-slate-500/15 text-muted',
    running: 'bg-cyan/15 text-cyan',
    completed: 'bg-emerald-500/15 text-success',
    failed: 'bg-red-500/15 text-danger',
  };
  return <Badge className={classes[job.status] ?? classes.pending}>{job.status}</Badge>;
}

/** Scrape-job results review table (SPEC.md §5 "Approval Flow"). */
export function ScraperJob() {
  const { id } = useParams<{ id: string }>();
  const { job, jobs, rawLeads, loading, error, refresh } = useScrapeJob(id!);
  const { pipelines } = usePipeline();
  const [pipelineId, setPipelineId] = useState('');
  const { approve, reject, skip } = useRawLeadActions(job?.org_id, pipelineId, job?.icp_id, job?.icp_params?.country);
  const [deepFindLead, setDeepFindLead] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!job) return;
    setPipelineId((current) => {
      const stillValid = pipelines.find((p) => p.id === current && p.org_id === job.org_id);
      if (stillValid) return current;
      const resolved = job.pipeline_id && pipelines.some((p) => p.id === job.pipeline_id) ? job.pipeline_id : null;
      const orgDefault = pipelines.find((p) => p.org_id === job.org_id && p.is_default);
      return resolved ?? orgDefault?.id ?? '';
    });
  }, [job, pipelines]);

  async function openDeepFind(raw: RawLead) {
    if (!job) return;
    setBusyId(raw.id); setRowError(null);
    try { setDeepFindLead(await scrapeDeepFindLeadId(supabase, raw, job.org_id)); }
    catch (error) {
      console.error('scraper: could not open Deep find');
      setRowError({ id: raw.id, text: error instanceof Error ? error.message : 'Could not open Deep find.' });
    } finally { setBusyId(null); }
  }

  async function runAction(lead: RawLead, fn: (l: RawLead) => Promise<string | null>) {
    setBusyId(lead.id); setRowError(null);
    try {
      const err = await fn(lead);
      if (err) setRowError({ id: lead.id, text: err });
      await refresh();
    } catch (err) {
      console.error('Scrape review failed', err instanceof Error ? err.name : 'unknown');
      setRowError({ id: lead.id, text: 'Could not finish this action. Refresh and try again.' });
    } finally { setBusyId(null); }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(ids: string[]) {
    setSelected((prev) => (prev.size === ids.length ? new Set() : new Set(ids)));
  }

  async function approveSelected(leads: RawLead[]) {
    setBulkBusy(true);
    try {
      for (const lead of leads) {
        if (!selected.has(lead.id)) continue;
        const err = await approve(lead);
        if (err) { setRowError({ id: lead.id, text: err }); break; }
      }
    } catch (err) {
      console.error('Scrape review failed', err instanceof Error ? err.name : 'unknown');
      setRowError({ id: '', text: 'Could not finish approval. Refresh and try again.' });
    } finally {
      setBulkBusy(false); setSelected(new Set()); void refresh();
    }
  }

  function exportCsv() {
    const headers = ['Business', 'Website', 'Company number', 'Owner', 'Phone', 'Email', 'City', 'Rating', 'Reviews', 'Source', 'Status'];
    const rows = rawLeads.map((l) => [
      l.business_name, l.website ?? '', l.companyNumber ?? '', l.owner_name ?? '', l.phone ?? '', l.email ?? '', l.city ?? '',
      l.google_rating?.toString() ?? '', l.review_count?.toString() ?? '', l.sources.map((s) => SOURCE_NAMES[s]).join('; '), l.status,
    ]);
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scrape-job-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!job) return <p role="alert" className="text-sm text-danger">{error ?? 'Job not found.'}</p>;

  const pending = rawLeads.filter((l) => l.status === 'pending' || l.status === 'duplicate');
  const now = Date.now();
  const running = jobs.some((j) => !isScrapeJobFinished(j, now));
  const timedOut = jobs.some((j) => isScrapeJobTimedOut(j, now));
  const reviewDisabled = running || !!error || busyId !== null || bulkBusy;
  const group = readScrapeGroup(job.icp_params);
  const missing = group?.sources.filter((s) => !jobs.some((j) => j.sources.includes(s))) ?? [];
  const status = running ? 'running' : jobs.every((j) => j.status === 'failed') ? 'failed' : 'completed';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Scrape results</h1>
          {statusBadge({ status })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SelectField label="Approve into" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Choose pipeline…</option>
            {pipelines.filter((p) => p.org_id === job.org_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectField>
          {selected.size > 0 && (
            <Button onClick={() => void approveSelected(pending)} disabled={reviewDisabled || !pipelineId} loading={bulkBusy}>
              {bulkBusy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
          )}
          <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
        </div>
      </header>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {rowError && !pending.some((l) => l.id === rowError.id) && <p role="alert" className="text-sm text-danger">{rowError.text}</p>}
      {group && <p className="text-sm text-muted">Search {group.id.slice(0, 8)} · {group.sources.map((s) => SOURCE_NAMES[s]).join(' + ')}</p>}
      {jobs.filter((j) => j.status === 'failed').map((j) => <p key={j.id} role="status" className="text-sm text-danger">{j.sources.map((s) => SOURCE_NAMES[s]).join(', ')} could not finish. Results from other sources are still available. Check Settings and try again.</p>)}
      {missing.map((s) => <p key={s} role="status" className="text-sm text-danger">{SOURCE_NAMES[s]} has not returned a job. Results from other sources are still available.</p>)}
      {running && <p role="status" className="text-sm text-muted">{rawLeads.length} businesses found so far. Review opens when all started sources finish.</p>}
      {timedOut && <p role="status" className="text-sm text-warning">One source did not finish. You can review what arrived.</p>}
      <p className="text-sm text-muted">Approve a result into a pipeline before using Deep find.</p>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="block w-full text-left text-sm sm:table">
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-line text-xs text-muted">
              <th className="p-3">
                <input type="checkbox" checked={selected.size > 0 && selected.size === pending.length} disabled={reviewDisabled} onChange={() => toggleSelectAll(pending.map((l) => l.id))} className="h-4 w-4 accent-violet-500" aria-label="Select all" />
              </th>
              <th className="p-3">Business</th>
              <th className="p-3">Phone</th>
              <th className="p-3">Email</th>
              <th className="p-3">Rating</th>
              <th className="p-3">City</th>
              <th className="p-3">Source</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {rawLeads.filter((lead) => lead.status !== 'rejected').map((lead) => (
              <tr key={lead.id} className={`grid grid-cols-2 border-b border-line sm:table-row ${lead.status === 'duplicate' ? 'bg-amber-500/10' : ''}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(lead.id)} disabled={reviewDisabled || lead.status === 'approved'} onChange={() => toggleSelected(lead.id)} className="h-4 w-4 accent-violet-500" aria-label={`Select ${lead.business_name}`} />
                </td>
                <td className="min-w-0 break-words p-3 font-semibold">
                  {lead.business_name}
                  {websiteHref(lead.website) && <a className="block break-all text-xs font-normal text-offwhite underline focus-visible:outline-2" href={websiteHref(lead.website)!} target="_blank" rel="noreferrer noopener">{lead.website}</a>}
                  {lead.companyNumber && <span className="block text-xs font-normal">Company {lead.companyNumber}</span>}
                  <details className="mt-2 text-xs font-normal">
                    <summary className="cursor-pointer focus-visible:outline-2">Source details</summary>
                    {lead.members.map((member) => <div key={member.id} className="mt-2 break-words">
                      <p className="font-semibold">{SOURCE_NAMES[member.source]}</p>
                      <p>{[member.business_name, member.website, member.phone, member.email, member.owner_name, member.address, member.postcode, member.city].filter(Boolean).join(' · ')}</p>
                      {Array.isArray(member.raw_data?.officers) && member.raw_data.officers.map((officer, i) => {
                        const person = officer as { first_name?: string; last_name?: string; title?: string };
                        return <p key={i}>{[person.first_name, person.last_name, person.title].filter(Boolean).join(' ')}</p>;
                      })}
                    </div>)}
                  </details>
                  {lead.status === 'duplicate' && <Badge className="ml-2 bg-amber-500/20 text-warning">Possible duplicate</Badge>}
                </td>
                <td className="min-w-0 break-words p-3"><span className="block text-xs text-muted sm:hidden">Phone</span>{lead.phone ?? '—'}</td>
                <td className="min-w-0 break-words p-3"><span className="block text-xs text-muted sm:hidden">Email</span>{lead.email ?? '—'}</td>
                <td className="p-3"><span className="block text-xs text-muted sm:hidden">Rating</span>{lead.google_rating ? `${lead.google_rating} (${lead.review_count ?? 0})` : '—'}</td>
                <td className="min-w-0 break-words p-3"><span className="block text-xs text-muted sm:hidden">City</span>{lead.city ?? '—'}</td>
                <td className="min-w-0 break-words p-3">{lead.sources.map((s) => SOURCE_NAMES[s]).join(' + ')}</td>
                <td className="col-span-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {lead.status !== 'approved' && <>
                    <Button variant="secondary" onClick={() => void runAction(lead, approve)} disabled={reviewDisabled || !pipelineId} loading={busyId === lead.id} title="Approve" aria-label={`Approve ${lead.business_name}`}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="danger" onClick={() => void runAction(lead, reject)} disabled={reviewDisabled} loading={busyId === lead.id} title="Reject" aria-label={`Reject ${lead.business_name}`}>
                      <XCircle className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" onClick={() => void runAction(lead, skip)} disabled={reviewDisabled} loading={busyId === lead.id} title="Skip" aria-label={`Skip ${lead.business_name}`}>
                      <SkipForward className="h-4 w-4" aria-hidden />
                    </Button>
                    </>}
                    {lead.status === 'approved' && <Badge>Approved</Badge>}
                    <Button variant="ghost" onClick={() => void openDeepFind(lead)} disabled={reviewDisabled || lead.status !== 'approved'} title={lead.status !== 'approved' ? 'Approve into a pipeline before using Deep find' : 'Deep find'} aria-label={`Deep find for ${lead.business_name}`}>Deep find</Button>
                  </div>
                  {rowError?.id === lead.id && <p role="alert" className="mt-1 text-xs text-danger">{rowError.text}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pending.length === 0 && rawLeads.length > 0 && (
          <p className="p-6 text-center text-sm text-muted">All results have been reviewed.</p>
        )}
      </div>
      <DeepFindModal open={deepFindLead !== null} leadIds={deepFindLead ? [deepFindLead] : []} onClose={() => setDeepFindLead(null)} />
    </div>
  );
}
