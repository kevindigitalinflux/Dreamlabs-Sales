import { geminiRefusalLine } from '../../../supabase/functions/_shared/geminiAdmission';
import { useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { ToggleChip } from '../ui/ToggleChip';
import { PRIORITY_LABEL, PRIORITY_ORDER, deepFindRowFlags, type DeepFindPriority } from '../../lib/deepFindPriority';
import { Skeleton } from '../ui/Skeleton';
import { useDeepFindRun } from '../../hooks/useDeepFindRun';
import { cancelDeepFind } from '../../lib/deepFind';
import { deepFindProgress } from '../../lib/deepFindView';
import { DeepFindLeadResult } from './DeepFindLeadResult';

/** Live progress of one Deep find run: per-lead status and results, credits used, and a Cancel button. */
export function DeepFindProgress({ runId, leadLevel = 2 }: { runId: string; leadLevel?: number }) {
  const { run, rows, loading, error, refresh } = useDeepFindRun(runId);
  const [cancelling, setCancelling] = useState(false);
  const [filter, setFilter] = useState<'all' | DeepFindPriority>('all');
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function handleCancel() {
    setCancelling(true);
    const err = await cancelDeepFind(runId);
    setCancelling(false);
    setCancelError(err);
    refresh();
  }

  const ranked = useMemo(
    () => rows.map((r) => ({ row: r, priority: deepFindRowFlags(r).priority }))
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)),
    [rows],
  );
  const counts = useMemo(() => {
    const c: Record<DeepFindPriority, number> = { most: 0, some: 0, none: 0, working: 0 };
    for (const r of ranked) c[r.priority] += 1;
    return c;
  }, [ranked]);
  const shown = ranked.filter((r) => filter === 'all' || r.priority === filter).map((r) => r.row);

  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) return <p role="alert" className="text-sm text-danger-strong">{error}</p>;
  if (!run) return <p className="text-sm">This Deep find could not be found.</p>;

  const p = deepFindProgress(rows);
  const active = run.status === 'active';
  const headline = active
    ? `Searching: ${p.done} of ${p.total} leads finished.`
    : run.status === 'cancelled' ? 'This Deep find was stopped.' : 'Deep find finished.';
  return (
    <div className="flex flex-col gap-3 text-offwhite">
      <p role="status" className="text-[15px] font-semibold">
        {headline} {p.people === 1 ? '1 person added so far.' : `${p.people} people added so far.`}
      </p>
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
        <span className="rounded-full border border-line bg-raised px-2.5 py-1">Hunter credits used: about {run.hunter_used} of {run.credit_cap_hunter}</span>
        <span className="rounded-full border border-line bg-raised px-2.5 py-1">AI calls used: {run.ai_used} of {run.credit_cap_ai}</span>
      </div>
      {geminiRefusalLine(run.gemini_refused_status) && <p role="alert" className="text-sm text-danger-strong">{geminiRefusalLine(run.gemini_refused_status)}</p>}
      {active && <p className="text-[13px]">You can close this window: Deep find keeps going in the background.</p>}
      {rows.length === 0 && <p className="text-sm">No leads in this Deep find.</p>}
      {rows.length > 1 && (
        <div role="group" aria-label="Show leads by how much they need you" className="flex flex-wrap items-center gap-2">
          <ToggleChip pressed={filter === 'all'} onPressedChange={() => setFilter('all')}>All {rows.length}</ToggleChip>
          {PRIORITY_ORDER.filter((key) => counts[key] > 0).map((key) => (
            <ToggleChip key={key} tone={key === 'most' ? 'attention' : 'default'} pressed={filter === key} onPressedChange={(on) => setFilter(on ? key : 'all')}>
              {PRIORITY_LABEL[key]} {counts[key]}
            </ToggleChip>
          ))}
        </div>
      )}
      <ul className="flex flex-col gap-3">{shown.map((r) => <DeepFindLeadResult key={r.id} row={r} level={leadLevel} />)}</ul>
      {filter !== 'all' && shown.length === 0 && <p className="text-sm text-muted">No leads in this group.</p>}
      {cancelError && <p role="alert" className="text-sm text-danger-strong">{cancelError}</p>}
      {active && (
        <Button variant="danger" onClick={() => void handleCancel()} loading={cancelling} disabled={cancelling}>
          {cancelling ? 'Stopping…' : 'Cancel Deep find'}
        </Button>
      )}
    </div>
  );
}
