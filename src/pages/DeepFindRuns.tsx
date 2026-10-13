import { Link } from 'react-router';
import { Telescope } from 'lucide-react';
import { useOrg } from '../hooks/useOrg';
import { useDeepFindActivity } from '../hooks/useDeepFindActivity';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { formatShortDate } from '../lib/utils';
import type { DeepFindRun } from '../types';

const RUN_STATUS: Record<DeepFindRun['status'], { label: string; className: string }> = {
  active: { label: 'Running', className: 'bg-cyan/15 text-cyan' },
  completed: { label: 'Finished', className: 'bg-green-500/15 text-success' },
  cancelled: { label: 'Stopped', className: 'bg-surface text-muted' },
};

/** /pipeline/deep-find: recent Deep find runs of the current organisation, live, each opening its full results. */
export function DeepFindRuns() {
  const { currentOrg } = useOrg();
  const { runs, totals, loading, error } = useDeepFindActivity(currentOrg?.id ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Deep find runs</h1>
        <Link to="/pipeline/list" className="text-sm text-muted hover:text-offwhite">Back to the pipeline</Link>
      </div>
      <p className="text-sm text-muted">Deep find keeps working in the background. Open a run to see each lead, choose companies and check people.</p>
      {loading && <Skeleton className="h-40 w-full" />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!loading && !error && runs.length === 0 && (
        <EmptyState icon={Telescope} title="No Deep find runs yet" hint="Select leads in the pipeline list and choose Deep find." />
      )}
      {!loading && !error && runs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {runs.map((run) => {
            const t = totals[run.id] ?? { done: 0, total: run.lead_count, people: 0, attention: 0 };
            const status = RUN_STATUS[run.status];
            return (
              <li key={run.id}>
                <Link to={`/pipeline/deep-find/${run.id}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3 hover:bg-surface/50">
                  <Badge className={status.className}>{status.label}</Badge>
                  <span className="text-sm font-semibold">Started {formatShortDate(run.started_at)}</span>
                  <span className="text-sm text-muted">{t.done} of {Math.max(t.total, run.lead_count)} leads done, {t.people} people added</span>
                  <span className="text-xs text-muted">Hunter credits {run.hunter_used}/{run.credit_cap_hunter}, AI calls {run.ai_used}/{run.credit_cap_ai}</span>
                  {t.attention > 0 && <Badge className="ml-auto bg-violet/15 text-violet">{t.attention} need you</Badge>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
