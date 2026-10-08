import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAutopilot } from '../../hooks/useAutopilot';
import { useOrg } from '../../hooks/useOrg';
import { useSelectableLeads } from '../../hooks/useSelectableLeads';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { emailGateMessage, pruneSelection, spendCapToCents, validateCaps, validateWindow } from '../../lib/selectableLeads';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SelectedLeadsPicker } from './SelectedLeadsPicker';
import { WindowFields, type WindowValues } from './WindowFields';

/** Setup for a selected-leads run: pick leads, set the sending window and caps, start. */
export function SelectedSetup() {
  const navigate = useNavigate();
  const { currentOrg } = useOrg();
  const { createSelectedRun } = useAutopilot();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<WindowValues>({
    start: '09:00', end: '17:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, dailySendCap: 20, spendCap: '',
  });
  const { session } = useAuth();
  const [mailbox, setMailbox] = useState<'unknown' | { verified: boolean } | null>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The run sends from the creator's own mailbox: refuse to start when it is not set up and verified.
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    void supabase.from('user_email_settings').select('is_verified').eq('user_id', uid).maybeSingle().then(
      ({ data: row, error: err }) => setMailbox(err ? 'unknown' : row ? { verified: !!(row as { is_verified: boolean }).is_verified } : null),
      () => setMailbox('unknown'),
    );
  }, [session?.user.id]);
  const mailboxError = emailGateMessage(mailbox);

  const data = useSelectableLeads(win.timeZone);
  // A different org's selection must never survive an org switch.
  useEffect(() => { setSelected(new Set()); setError(null); }, [currentOrg?.id]);

  const visibleSelected = useMemo(() => pruneSelection(selected, data.byPipeline), [selected, data.byPipeline]);
  const windowError = useMemo(() => validateWindow(win.start, win.end, win.timeZone, new Date()), [win.start, win.end, win.timeZone]);
  const capsError = validateCaps(win.dailySendCap, win.spendCap);
  const canStart = visibleSelected.length > 0 && !mailboxError && !windowError && !capsError && !busy && !data.loading;

  async function handleStart() {
    // Re-validate against the latest clock and picker data, not values memoised earlier.
    const leadIds = pruneSelection(selected, data.byPipeline);
    const problem = mailboxError ?? (leadIds.length === 0 ? 'Select at least one lead' : validateWindow(win.start, win.end, win.timeZone, new Date()) ?? validateCaps(win.dailySendCap, win.spendCap));
    if (problem) return setError(problem);
    setBusy(true); setError(null);
    const res = await createSelectedRun({
      leadIds, eligibleLeadIds: data.byPipeline.flatMap((g) => g.eligible.map((l) => l.id)), windowStart: win.start, windowEnd: win.end, timeZone: win.timeZone,
      dailySendCap: win.dailySendCap, maxTotalSpendCents: spendCapToCents(win.spendCap),
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    navigate('/outreach/autopilot', { state: res.notice ? { notice: res.notice } : undefined });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {mailboxError && <p role="alert" className="text-sm text-danger">{mailboxError}</p>}
      <SelectedLeadsPicker value={selected} onChange={setSelected} data={data} count={visibleSelected.length} />
      <Card>
        <WindowFields value={win} onChange={setWin} windowError={windowError ?? capsError} />
      </Card>
      <div className="flex justify-end">
        <Button onClick={() => void handleStart()} disabled={!canStart} loading={busy}>{busy ? 'Starting…' : 'Start autopilot'}</Button>
      </div>
    </div>
  );
}
