import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ListChecks } from 'lucide-react';
import { useJobs } from '../hooks/useJobs';
import { JobRow } from '../components/jobs/JobRow';
import { ConfirmDialog } from '../components/jobs/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { isFinishedState, type JobItem, type JobKind } from '../lib/jobs/model';

const KIND_NAME: Record<JobKind, string> = { deep_find: 'Deep find', selected_outreach: 'Outreach to selected leads', scrape: 'Lead searches', campaign: 'Autopilot campaigns' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[18px] font-bold">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/** /jobs: every background job of the current organisation, named by its leads, grouped by what needs attention. */
export function Jobs() {
  const { jobs, groups, failedKinds, loading, now, remove, stop, clearFinished, markFinishedSeen } = useJobs();
  const [toDelete, setToDelete] = useState<JobItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Opening this page counts as having seen everything that finished.
  useEffect(() => { markFinishedSeen(); }, [markFinishedSeen, jobs]);

  const clearable = jobs.filter((j) => isFinishedState(j.state) && j.canDelete);

  async function doDelete(job: JobItem) {
    const err = await remove(job.id);
    setToDelete(null);
    setRowErrors((prev) => { const next = { ...prev }; if (err) next[job.id] = err; else delete next[job.id]; return next; });
  }

  async function doStop(job: JobItem) {
    setStopping(job.id);
    const err = await stop(job.id);
    setStopping(null);
    setRowErrors((prev) => { const next = { ...prev }; if (err) next[job.id] = err; else delete next[job.id]; return next; });
  }

  async function doClear() {
    const { deleted, failed } = await clearFinished();
    setConfirmClear(false);
    setNotice(failed > 0 ? `Deleted ${deleted}. ${failed} could not be deleted. Open them to see why.` : `Deleted ${deleted} finished ${deleted === 1 ? 'job' : 'jobs'}.`);
  }

  const row = (job: JobItem) => (
    <JobRow key={job.id} job={job} now={now} stopping={stopping === job.id} error={rowErrors[job.id] ?? null}
      onStop={() => void doStop(job)} onDelete={() => setToDelete(job)} />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Jobs</h1>
        {clearable.length > 0 && <Button variant="secondary" onClick={() => setConfirmClear(true)}>Clear finished ({clearable.length})</Button>}
      </div>
      <p className="text-sm text-muted">Everything that works in the background, named by the leads it is working on. Jobs that need you stay at the top.</p>

      {failedKinds.map((kind) => (
        <p key={kind} role="alert" className="text-sm text-danger">{KIND_NAME[kind]} could not be loaded right now. The rest are shown.</p>
      ))}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}

      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && jobs.length === 0 && failedKinds.length === 0 && (
        <EmptyState icon={ListChecks} title="No background jobs yet" hint="Deep find, outreach to selected leads and lead searches show up here while they work." />
      )}

      {groups.needsYou.length > 0 && <Section title="Needs you">{groups.needsYou.map(row)}</Section>}
      {groups.running.length > 0 && <Section title="Running">{groups.running.map(row)}</Section>}
      {groups.finished.length > 0 && <Section title="Finished">{groups.finished.map(row)}</Section>}
      {groups.older.length > 0 && (
        <section className="flex flex-col gap-2">
          <Button variant="ghost" className="self-start" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
            {showOlder ? 'Hide' : 'Show'} {groups.older.length} older {groups.older.length === 1 ? 'job' : 'jobs'} (over 14 days)
          </Button>
          {showOlder && <ul className="flex flex-col gap-2">{groups.older.map(row)}</ul>}
        </section>
      )}
      <p className="text-xs text-muted">Shows the last 60 days (up to 100 jobs of each kind). Older jobs are still stored.</p>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this job?"
        body={toDelete ? `“${toDelete.title}” will be removed from your list.` : ''}
        warning={toDelete?.deleteWarning ?? null}
        confirmLabel="Delete"
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
        onClose={() => setToDelete(null)}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear finished jobs?"
        body={`${clearable.length} finished, failed or stopped ${clearable.length === 1 ? 'job' : 'jobs'} will be deleted. Jobs that are running or need you are not touched.`}
        warning="Leads in your pipeline, people already added, and sent emails stay. Results you have not reviewed in finished searches are removed."
        confirmLabel={`Delete ${clearable.length}`}
        onConfirm={doClear}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
