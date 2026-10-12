import { useState } from 'react';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { useDeepFindRun } from '../../hooks/useDeepFindRun';
import { cancelDeepFind } from '../../lib/deepFind';
import { deepFindProgress } from '../../lib/deepFindView';
import { DeepFindLeadResult } from './DeepFindLeadResult';

/** Live progress of one Deep find run: per-lead status and results, credits used, and a Cancel button. */
export function DeepFindProgress({ runId }: { runId: string }) {
  const { run, rows, loading, error, refresh } = useDeepFindRun(runId);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    const err = await cancelDeepFind(runId);
    setCancelling(false);
    setCancelError(err);
    refresh();
  }

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!run) return <p className="text-sm text-muted">This Deep find could not be found.</p>;

  const p = deepFindProgress(rows);
  const active = run.status === 'active';
  const headline = active
    ? `Searching: ${p.done} of ${p.total} leads finished.`
    : run.status === 'cancelled' ? 'This Deep find was stopped.' : 'Deep find finished.';
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="text-sm">
        {headline} {p.people === 1 ? '1 person added so far.' : `${p.people} people added so far.`}
      </p>
      <p className="text-xs text-muted">
        Hunter calls used: {run.hunter_used} of {run.credit_cap_hunter}. AI calls used: {run.ai_used} of {run.credit_cap_ai}.
        {active && ' You can close this window: Deep find keeps going in the background.'}
      </p>
      {rows.length === 0 && <p className="text-sm text-muted">No leads in this Deep find.</p>}
      <ul className="flex flex-col gap-2">{rows.map((r) => <DeepFindLeadResult key={r.id} row={r} />)}</ul>
      {cancelError && <p role="alert" className="text-sm text-danger">{cancelError}</p>}
      {active && (
        <Button variant="danger" onClick={() => void handleCancel()} loading={cancelling} disabled={cancelling}>
          {cancelling ? 'Stopping…' : 'Cancel Deep find'}
        </Button>
      )}
    </div>
  );
}
