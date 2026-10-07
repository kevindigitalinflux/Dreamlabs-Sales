import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAutopilot } from '../../hooks/useAutopilot';
import { validateWindow } from '../../lib/selectableLeads';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SelectedLeadsPicker } from './SelectedLeadsPicker';
import { WindowFields, type WindowValues } from './WindowFields';

/** Setup for a selected-leads run: pick leads, set the sending window and caps, start. */
export function SelectedSetup() {
  const navigate = useNavigate();
  const { createSelectedRun } = useAutopilot();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<WindowValues>({
    start: '09:00', end: '17:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, dailySendCap: 20, spendCap: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const windowError = useMemo(() => validateWindow(win.start, win.end, win.timeZone, new Date()), [win.start, win.end, win.timeZone]);
  const canStart = selected.size > 0 && !windowError && !busy;

  async function handleStart() {
    setBusy(true); setError(null);
    const res = await createSelectedRun({
      leadIds: [...selected], windowStart: win.start, windowEnd: win.end, timeZone: win.timeZone,
      dailySendCap: win.dailySendCap, maxTotalSpendCents: win.spendCap ? Math.round(Number(win.spendCap) * 100) : null,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    navigate('/outreach/autopilot', { state: res.notice ? { notice: res.notice } : undefined });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <SelectedLeadsPicker value={selected} onChange={setSelected} timeZone={win.timeZone} />
      <Card>
        <WindowFields value={win} onChange={setWin} windowError={windowError} />
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => void handleStart()} disabled={!canStart} loading={busy}>{busy ? 'Starting…' : 'Start autopilot'}</Button>
      </div>
    </div>
  );
}
