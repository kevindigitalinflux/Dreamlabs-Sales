import { useState } from 'react';
import { XCircle } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { runFinishNote, runStatusLabel } from '../../lib/runLeadGroups';
import type { AutopilotRun } from '../../types';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface RunHeaderProps {
  run: AutopilotRun;
  /** Whether any row ended because the finish time passed (used for the finish note). */
  rows: { status: string; reason: string | null }[];
  onStop: () => Promise<string | null>;
}

/** Summary card for a selected run: window, status, sent vs cap, AI spend vs cap, and Stop. */
export function RunHeader({ run, rows, onStop }: RunHeaderProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const note = runFinishNote(run, rows);
  const active = run.status === 'active';

  const stop = async () => { setBusy(true); setError(await onStop()); setBusy(false); };

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">Selected leads run</p>
          <Badge className={active ? 'bg-cyan/15 text-cyan' : 'bg-surface text-muted'}>{runStatusLabel(run.status)}</Badge>
        </div>
        {run.window_start && run.window_end && (
          <p className="text-sm text-muted">
            Sending {run.window_start} to {run.window_end}{run.timezone ? ` (${run.timezone})` : ''}{run.window_date ? ` on ${run.window_date}` : ''}
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
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {active && (
          <Button variant="danger" onClick={() => void stop()} disabled={busy} loading={busy}>
            <XCircle className="h-4 w-4" aria-hidden /> Stop this run
          </Button>
        )}
      </div>
    </Card>
  );
}
