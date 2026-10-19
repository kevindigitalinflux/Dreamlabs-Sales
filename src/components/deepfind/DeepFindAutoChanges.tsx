import { useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { undoDeepFindChange } from '../../lib/deepFindReview';
import { logDeepFindError } from '../../lib/deepFindErrors';
import type { AutoApplied } from '../../../supabase/functions/_shared/deepFindAutoApply';
import { Button } from '../ui/Button';

export function AutoChangeRows({ changes, busy, notices, onUndo }: {
  changes: AutoApplied[]; busy: boolean; notices: Record<number, string>; onUndo: (change: AutoApplied, index: number) => void;
}) {
  return <div className="flex min-w-0 flex-col gap-2">
    <p className="text-sm font-semibold">Deep find changed these automatically</p>
    <ul className="flex min-w-0 flex-col gap-2">
      {changes.map((change, index) => <li key={`${change.table}:${change.id}:${change.field}:${index}`} className="min-w-0 rounded-md border border-line p-2">
        <p className="break-words text-xs">{change.table === 'leads' ? 'Lead' : 'Contact'} {change.field.replace(/_/g, ' ')}: {String(change.before ?? '') || 'blank'} → {String(change.after)}</p>
        <Button variant="ghost" disabled={busy || !!notices[index]} aria-label={`Undo ${change.field.replace(/_/g, ' ')} change ${index + 1}`} onClick={() => onUndo(change, index)}>Undo</Button>
        {notices[index] && <p role="status" className="text-xs text-muted">{notices[index]}</p>}
      </li>)}
    </ul>
  </div>;
}

/** Generic, session-only Undo shared by automatic website and contact changes. */
export function DeepFindAutoChanges({ leadId, changes }: { leadId: string; changes: AutoApplied[] }) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notices, setNotices] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const saving = useRef(false);
  const status = useRef<HTMLParagraphElement>(null);
  async function undo(change: AutoApplied, index: number) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    status.current?.focus();
    try {
      const notice = await undoDeepFindChange(supabase, session?.user.id ?? null, leadId, change);
      setNotices((old) => ({ ...old, [index]: notice }));
    } catch (error: unknown) {
      logDeepFindError('deep find: automatic change could not be undone', error);
      setError('Could not undo this change. Refresh and try again.');
    } finally { saving.current = false; setBusy(false); }
  }
  if (!changes.length) return null;
  return <div aria-busy={busy} className="min-w-0">
    <p ref={status} tabIndex={-1} role="status" className="text-xs text-muted focus:outline focus:outline-cyan">{busy ? 'Undoing…' : Object.values(notices).at(-1) ?? ''}</p>
    <AutoChangeRows changes={changes} busy={busy} notices={notices} onUndo={(change, index) => void undo(change, index)} />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </div>;
}
