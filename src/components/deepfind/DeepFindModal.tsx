import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { startDeepFind } from '../../lib/deepFind';
import { DEEP_FIND_CAP_LIMITS, DEEP_FIND_DEFAULT_CAPS, DEEP_FIND_MAX_LEADS, parseCap } from '../../lib/deepFindView';
import { DeepFindConfirm } from './DeepFindConfirm';
import { DeepFindProgress } from './DeepFindProgress';
import { effortTotals, type Effort } from '../../../supabase/functions/_shared/deepFindEffort';

interface DeepFindModalProps {
  open: boolean;
  leadIds: string[];
  onClose: () => void;
  /** Called once the run has started (for example to clear a selection). */
  onStarted?: (runId: string) => void;
}

/** Confirm step (what it does, editable caps), then the live progress view for the run it started. */
export function DeepFindModal({ open, leadIds, onClose, onStarted }: DeepFindModalProps) {
  const [effort, setEffort] = useState<Effort>('medium');
  const [hunterCap, setHunterCap] = useState(String(DEEP_FIND_DEFAULT_CAPS.hunter));
  const [aiCap, setAiCap] = useState(String(DEEP_FIND_DEFAULT_CAPS.ai));
  const [startFresh, setStartFresh] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRunId(null); setError(null); setNotice(null); setStarting(false);
    setEffort('medium'); setStartFresh(false);
    setHunterCap(String(DEEP_FIND_DEFAULT_CAPS.hunter)); setAiCap(String(DEEP_FIND_DEFAULT_CAPS.ai));
  }, [open]);

  const totals = effort === 'custom' ? null : effortTotals(effort, leadIds.length);
  const hunter = totals?.hunter ?? parseCap(hunterCap, DEEP_FIND_CAP_LIMITS.hunter);
  const ai = totals?.ai ?? parseCap(aiCap, DEEP_FIND_CAP_LIMITS.ai);
  const capError = hunter === null || ai === null ? 'Enter whole numbers within the limits shown.' : null;
  const tooMany = leadIds.length > DEEP_FIND_MAX_LEADS;

  async function handleStart() {
    if (hunter === null || ai === null || tooMany || leadIds.length === 0) return;
    setStarting(true);
    setError(null);
    const res = await startDeepFind(leadIds, { hunter, ai }, effort, { startFresh });
    setStarting(false);
    if ('error' in res) { setError(res.error); return; }
    if (res.alreadyRunning > 0) setNotice(`${res.alreadyRunning} of the leads were already being searched, so they were left out.`);
    setRunId(res.runId);
    onStarted?.(res.runId);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deep find"
      footer={runId ? undefined : (
        <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <Button variant="ghost" className="!text-offwhite" onClick={onClose}>Cancel</Button>
          <Button className="min-w-40" onClick={() => void handleStart()} loading={starting} disabled={starting || !!capError || tooMany || leadIds.length === 0}>
            {starting ? 'Starting…' : 'Start Deep find'}
          </Button>
        </div>
      )}
    >
      {runId ? (
        <div className="flex flex-col gap-3">
          {notice && <p role="status" className="text-sm">{notice}</p>}
          <DeepFindProgress runId={runId} leadLevel={4} />
          <Link to={`/pipeline/deep-find/${runId}`} onClick={onClose} className="text-[13px] underline hover:text-offwhite">
            Open this run on its own page (it stays in Deep find runs after you close this window)
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {tooMany && <p role="alert" className="text-sm text-danger-strong">Choose {DEEP_FIND_MAX_LEADS} leads or fewer for one Deep find.</p>}
          {leadIds.length === 0 && <p className="text-sm">Choose at least one lead.</p>}
          <DeepFindConfirm
            leadCount={leadIds.length} hunterCap={hunterCap} aiCap={aiCap}
            onHunterCap={setHunterCap} onAiCap={setAiCap} capError={capError}
            effort={effort} onEffort={setEffort}
            startFresh={startFresh} onStartFresh={setStartFresh}
          />
          {error && <p role="alert" className="text-sm text-danger-strong">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
