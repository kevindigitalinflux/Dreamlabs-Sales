import { RunControls } from './RunControls';
import { Badge } from '../ui/Badge';
import { Card } from '../ui/Card';
import { formatWindowDate, runFinishNote, runStatusLabel } from '../../lib/runLeadGroups';
import type { AutopilotRun } from '../../types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface RunHeaderProps {
  run: AutopilotRun;
  /** The run's lead rows (status and reason), used to work out why the run ended. */
  rows: { status: string; reason: string | null }[];
  onStop: () => Promise<string | null>;
  onControl: (action: 'pause' | 'resume' | 'stop') => Promise<string | null>;
  canControl: boolean;
}

/** Summary card for a selected run: window, status, sent vs cap, AI spend vs cap, and Stop. */
export function RunHeader({ run, rows, onControl, canControl }: RunHeaderProps) {
  const note = runFinishNote(run, rows);
  const active = run.status === 'active';

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Selected leads run</p>
          <Badge className={active ? 'bg-cyan/15 text-cyan' : 'bg-surface text-muted'}>{runStatusLabel(run.status)}</Badge>
        </div>
        {run.window_start && run.window_end && (
          <p className="text-sm text-muted">
            Sending {run.window_start} to {run.window_end}{run.timezone ? ` (${run.timezone})` : ''}{run.window_date ? ` on ${formatWindowDate(run.window_date)}` : ''}
          </p>
        )}
        <p className="text-sm text-muted">
          Sent {run.outreach_sent_total}{run.daily_send_cap != null ? ` of ${run.daily_send_cap} allowed` : ' (no cap)'}
        </p>
        <p className="text-sm text-muted">
          AI spend so far: {money(run.actual_ai_cost_cents)}
          {run.max_total_spend_cents != null ? ` of ${money(run.max_total_spend_cents)} cap` : ' (no spend cap)'}
        </p>
        {note && <p role="status" className="text-sm font-semibold text-warning">{note}</p>}
        {run.status === 'cancelled' && run.cancel_reason && <p className="text-sm text-muted">Stopped: {run.cancel_reason}</p>}
        <RunControls run={run} rows={rows} onControl={onControl} canControl={canControl} />
      </div>
    </Card>
  );
}
