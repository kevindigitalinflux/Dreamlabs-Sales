import { Link } from 'react-router';
import { Button } from '../ui/Button';
import { buttonClasses } from '../../lib/ui/buttonClasses';
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

/** One job on one compact row: state, what it works on and what happened, then its actions. */
export function JobRow({ job, now, stopping, error, onStop, onDelete }: JobRowProps) {
  const badge = BADGE[job.state];
  const pct = job.progress && job.progress.total > 0 ? Math.min(100, Math.round((job.progress.done / job.progress.total) * 100)) : null;
  return (
    <li className="flex flex-col gap-2 rounded-surface border border-line bg-raised p-3 shadow-raised">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex w-36 shrink-0 items-center gap-2 text-sm font-semibold">
          <span className={`h-2.5 w-2.5 rounded-full ${badge.dot}`} aria-hidden />
          {badge.label}
        </span>
        <div className="min-w-0 flex-1 basis-64">
          <Link to={job.href} className="block truncate text-[15px] font-semibold hover:underline">{job.title}</Link>
          <p className="line-clamp-2 text-sm text-muted">{job.detail}</p>
          <p className="text-[13px] text-muted">{KIND_LABEL[job.kind]}, started {timeAgo(job.startedAt, now)}</p>
          {job.deleteBlockedReason && <p className="text-[13px] text-muted">{job.deleteBlockedReason}</p>}
        </div>
        {pct !== null && (
          <div className="flex w-32 shrink-0 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.title} progress`}>
              <div className="h-full bg-violet" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[13px] tabular-nums text-muted">{pct}%</span>
          </div>
        )}
        <div className="flex shrink-0 gap-2">
          <Link to={job.href} className={buttonClasses('secondary', 'sm')}>Open</Link>
          {job.canStop && <Button variant="secondary" size="sm" loading={stopping} onClick={onStop}>Stop</Button>}
          {job.canDelete && <Button variant="ghost" size="sm" onClick={onDelete}>Delete</Button>}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </li>
  );
}
