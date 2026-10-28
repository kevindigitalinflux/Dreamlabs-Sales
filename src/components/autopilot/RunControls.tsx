import { selectedRunBounds } from '../../../supabase/functions/_shared/runPauseRules';
import { useEffect, useRef, useState } from 'react';
import { runControlState } from '../../lib/runControlState';
import { inWindow } from '../../../supabase/functions/_shared/autopilotEligibility';
import type { AutopilotRun } from '../../types';
import { Button } from '../ui/Button';

/** Controls share a stable status focus target after any state-changing request. */
export function RunControls({run, rows, canControl, onControl}: {
  run: AutopilotRun; rows: {status: string}[]; canControl: boolean;
  onControl: (action: 'pause' | 'resume' | 'stop') => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const working = rows.filter(r => r.status === 'working').length;
  const actions = runControlState(run, working, rows.filter(r => r.status === 'queued').length);
  let status = run.status === 'completed' ? 'Completed' : run.status === 'cancelled' ? 'Stopped' : 'Active';
  if (run.status === 'paused') {
    const minutes = Math.max(0, Math.floor((now - Date.parse(run.paused_at ?? new Date(now).toISOString())) / 60_000));
    status = working ? 'Pausing, finishing the current email' : `Paused for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Resume when you are ready.`;
  } else if (run.status === 'active') {
    if (run.daily_send_cap != null && run.outreach_sent_total >= run.daily_send_cap) status = 'This run has reached its send allowance and will finish shortly';
    else if (run.max_total_spend_cents != null && run.actual_ai_cost_cents >= run.max_total_spend_cents) status = 'This run has reached its spend cap and will finish shortly';
    else if (run.window_start && run.window_end && run.window_date) {
      const bounds = selectedRunBounds(run, new Date(now));
      if (!bounds || !inWindow(new Date(now), bounds)) status = run.resumed_at ? 'This run will continue at the next send window. Stop is available.' : 'Waiting for the send window to open. Nothing will send before then.';
    }
  }
  async function act(action: 'pause' | 'resume' | 'stop') {
    setBusy(true); setError(null);
    try { setError(await onControl(action)); }
    catch { console.error('autopilot: control request failed'); setError('Could not change this run. Please try again.'); }
    finally { setBusy(false); statusRef.current?.focus(); }
  }
  return <div className="flex flex-col gap-2">
    <p role="status" tabIndex={-1} ref={statusRef} className="text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-line">{status}</p>
    {run.status === 'active' && <p className="text-xs text-muted">Sending also waits for the sender’s daily allowance and all safety checks.</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {canControl && <div className="flex flex-wrap gap-2">{actions.map(action => action === 'pausing'
      ? <Button key={action} disabled>Pausing, finishing the current email</Button>
      : <Button key={action} variant={action === 'stop' ? 'danger' : 'primary'} disabled={busy} onClick={() => void act(action === 'resume_stopped' ? 'resume' : action as 'pause' | 'resume' | 'stop')}>
        {action === 'resume_stopped' ? 'Resume this run' : action === 'pause' ? 'Pause' : action === 'resume' ? 'Resume' : 'Stop'}
      </Button>)}</div>}
  </div>;
}
