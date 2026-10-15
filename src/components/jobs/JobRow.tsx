import { Link } from 'react-router';
import { Button } from '../ui/Button';
import { timeAgo } from '../../lib/jobs/view';
import type { JobItem, JobState } from '../../lib/jobs/model';

// Text is always the normal text colour; only the dot is coloured (cyan or green text fails contrast on the light theme).
const BADGE: Record<JobState, { label: string; dot: string }> = {
  needs_you: { label: 'Needs you', dot: 'bg-violet' },
  running: { label: 'Running', dot: 'bg-cyan' },
  done: { label: 'Done', dot: 'bg-success' },
  failed: { label: 'Did not finish', dot: 'bg-danger' },
  stopped: { label: 'Stopped', dot: 'bg-muted' },
};

const KIND_LABEL: Record<JobItem['kind'], string> = {
  deep_find: 'Deep find',
  selected_outreach: 'Outreach to selected leads',
  scrape: 'Lead search',
  campaign: 'Autopilot',
  lookup: 'Lookup',
};

interface JobRowProps {
  job: JobItem;
  now: Date;
  stopping: boolean;
  error: string | null;
  onStop: () => void;
  onDelete: () => void;
}

/** One job: state badge in words, what it works on, one plain line, progress, when, and its actions. */
export function JobRow({ job, now, stopping, error, onStop, onDelete }: JobRowProps) {
  const badge = BADGE[job.state];
  const pct = job.progress && job.progress.total > 0 ? Math.min(100, Math.round((job.progress.done / job.progress.total) * 100)) : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-offwhite">
          <span className={`h-2 w-2 rounded-full ${badge.dot}`} aria-hidden />
          {badge.label}
        </span>
        <span className="text-xs text-muted">{KIND_LABEL[job.kind]}</span>
        <span className="text-xs text-muted">Started {timeAgo(job.startedAt, now)}</span>
      </div>
      <Link to={job.href} className="text-[15px] font-bold hover:underline">{job.title}</Link>
      <p className="text-sm text-muted">{job.detail}</p>
      {job.deleteBlockedReason && <p className="text-sm text-muted">{job.deleteBlockedReason}</p>}
      {pct !== null && (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.title} progress`}>
          <div className="h-full bg-violet" style={{ width: `${pct}%` }} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Link to={job.href} className="flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface/70">Open</Link>
        {job.canStop && <Button variant="secondary" loading={stopping} onClick={onStop}>Stop</Button>}
        {job.canDelete && <Button variant="ghost" onClick={onDelete}>Delete</Button>}
      </div>
    </li>
  );
}
