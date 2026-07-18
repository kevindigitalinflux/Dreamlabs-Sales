import { useState } from 'react';
import { Pause, Play, Repeat, XCircle } from 'lucide-react';
import { useEnrollments } from '../../hooks/useEnrollments';
import { useSequences } from '../../hooks/useSequences';
import { formatShortDate } from '../../lib/utils';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import { Skeleton } from '../ui/Skeleton';

/** Enroll a lead in a sequence, or manage the active enrollment (SPEC §7). */
export function EnrollmentControl({ lead }: { lead: Lead }) {
  const { enrollment, loading, enroll, setStatus } = useEnrollments(lead.id);
  const { sequences } = useSequences();
  const [picked, setPicked] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true); setError(null);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
  }

  if (loading) return <Skeleton className="h-16 w-full" />;

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-2">
        {!lead.email && <p className="text-xs text-amber-400">Add an email address to this lead first — sequences draft emails.</p>}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <SelectField label="Enroll in sequence" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Choose…</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          </div>
          <Button onClick={() => picked && void run(() => enroll(picked))} disabled={busy || !picked || !lead.email}>
            <Repeat className="h-4 w-4" aria-hidden />Enroll
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  const total = enrollment.sequence.steps.length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        <span className="font-semibold">{enrollment.sequence.name}</span>
        <span className="text-muted"> — step {enrollment.current_step} of {total}</span>
      </p>
      <p className="text-xs text-muted">
        {enrollment.status === 'paused' ? 'Paused' : enrollment.next_send_at ? `Next draft ${formatShortDate(enrollment.next_send_at)}` : 'Finishing'}
        {' · drafts land in your review queue — nothing sends itself'}
      </p>
      <div className="flex gap-2">
        {enrollment.status === 'active'
          ? <Button variant="secondary" onClick={() => void run(() => setStatus('paused'))} disabled={busy}><Pause className="h-4 w-4" aria-hidden />Pause</Button>
          : <Button variant="secondary" onClick={() => void run(() => setStatus('active'))} disabled={busy}><Play className="h-4 w-4" aria-hidden />Resume</Button>}
        <Button variant="ghost" onClick={() => void run(() => setStatus('cancelled'))} disabled={busy}><XCircle className="h-4 w-4" aria-hidden />Cancel</Button>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
