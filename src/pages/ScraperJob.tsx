import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, XCircle, SkipForward, Sparkles, Mail } from 'lucide-react';
import { useScrapeJob } from '../hooks/useScrapeJob';
import { useRawLeadActions } from '../hooks/useRawLeadActions';
import { useOrgApiSettings } from '../hooks/useOrgApiSettings';
import { usePipeline } from '../hooks/usePipeline';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { SelectField } from '../components/ui/Input';
import { toCsv } from '../lib/csv';
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
  const { job, rawLeads, loading, refresh } = useScrapeJob(id!);
  const { pipelines } = usePipeline();
  const [pipelineId, setPipelineId] = useState('');
  const { approve, reject, skip, enrichWithApollo, enrichWithHunter } = useRawLeadActions(job?.org_id, pipelineId);
  const { settings } = useOrgApiSettings();
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

  const apolloConfigured = settings.find((s) => s.provider === 'apollo')?.is_configured ?? false;
  const hunterConfigured = settings.find((s) => s.provider === 'hunter')?.is_configured ?? false;

  async function runAction(lead: RawLead, fn: (l: RawLead) => Promise<string | null>) {
    setBusyId(lead.id); setRowError(null);
    const err = await fn(lead);
    setBusyId(null);
    if (err) setRowError({ id: lead.id, text: err });
    else void refresh();
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
    for (const lead of leads) {
      if (!selected.has(lead.id)) continue;
      const err = await approve(lead);
      if (err) setRowError({ id: lead.id, text: err });
    }
    setBulkBusy(false);
    setSelected(new Set());
    void refresh();
  }

  function exportCsv() {
    const headers = ['Business', 'Phone', 'Email', 'City', 'Rating', 'Reviews', 'Source', 'Status'];
    const rows = rawLeads.map((l) => [
      l.business_name, l.phone ?? '', l.email ?? '', l.city ?? '',
      l.google_rating?.toString() ?? '', l.review_count?.toString() ?? '', l.source, l.status,
    ]);
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scrape-job-${id}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <Skeleton className="h-96 w-full" />;
  if (!job) return <p role="alert" className="text-sm text-danger">Job not found.</p>;

  const pending = rawLeads.filter((l) => l.status === 'pending' || l.status === 'duplicate');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Scrape results</h1>
          {statusBadge(job)}
        </div>
        <div className="flex items-center gap-3">
          <SelectField label="Approve into" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">Choose pipeline…</option>
            {pipelines.filter((p) => p.org_id === job.org_id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </SelectField>
          {selected.size > 0 && (
            <Button onClick={() => void approveSelected(pending)} disabled={bulkBusy || !pipelineId}>
              {bulkBusy ? 'Approving…' : `Approve selected (${selected.size})`}
            </Button>
          )}
          <Button variant="secondary" onClick={exportCsv} disabled={rawLeads.length === 0}>Download CSV</Button>
        </div>
      </header>
      {job.status === 'failed' && <p role="alert" className="text-sm text-danger">{job.error_message}</p>}
      {job.status !== 'completed' && job.status !== 'failed' && (
        <p className="text-sm text-muted">{job.results_count} found so far — still running…</p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="p-3">
                <input type="checkbox" checked={selected.size > 0 && selected.size === pending.length} onChange={() => toggleSelectAll(pending.map((l) => l.id))} className="h-4 w-4 accent-violet-500" aria-label="Select all" />
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
          <tbody>
            {pending.map((lead) => (
              <tr key={lead.id} className={`border-b border-line ${lead.status === 'duplicate' ? 'bg-amber-500/10' : ''}`}>
                <td className="p-3">
                  <input type="checkbox" checked={selected.has(lead.id)} onChange={() => toggleSelected(lead.id)} className="h-4 w-4 accent-violet-500" aria-label={`Select ${lead.business_name}`} />
                </td>
                <td className="p-3 font-semibold">
                  {lead.business_name}
                  {lead.status === 'duplicate' && <Badge className="ml-2 bg-amber-500/20 text-warning">Possible duplicate</Badge>}
                </td>
                <td className="p-3">{lead.phone ?? '—'}</td>
                <td className="p-3">{lead.email ?? '—'}</td>
                <td className="p-3">{lead.google_rating ? `${lead.google_rating} (${lead.review_count ?? 0})` : '—'}</td>
                <td className="p-3">{lead.city ?? '—'}</td>
                <td className="p-3">{lead.source}</td>
                <td className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" onClick={() => void runAction(lead, approve)} disabled={busyId === lead.id || !pipelineId} title="Approve">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="danger" onClick={() => void runAction(lead, reject)} disabled={busyId === lead.id} title="Reject">
                      <XCircle className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" onClick={() => void runAction(lead, skip)} disabled={busyId === lead.id} title="Skip">
                      <SkipForward className="h-4 w-4" aria-hidden />
                    </Button>
                    {apolloConfigured && lead.website && (
                      <Button variant="ghost" onClick={() => void runAction(lead, enrichWithApollo)} disabled={busyId === lead.id} title="Enrich with Apollo — uses 1 Apollo credit">
                        <Sparkles className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                    {hunterConfigured && lead.website && !lead.email && (
                      <Button variant="ghost" onClick={() => void runAction(lead, enrichWithHunter)} disabled={busyId === lead.id} title="Find email with Hunter — uses 1 Hunter credit">
                        <Mail className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
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
    </div>
  );
}
