import { useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { undoDeepFindChange } from '../../lib/deepFindReview';
import { logDeepFindError } from '../../lib/deepFindErrors';
import type { AutoApplied } from '../../../supabase/functions/_shared/deepFindAutoApply';
import { Button } from '../ui/Button';
import { Heading, shortValue } from './Heading';

export function AutoChangeRows({ changes, busy, notices, onUndo, headingLevel = 3 }: {
  headingLevel?: number; changes: AutoApplied[]; busy: boolean; notices: Record<number, string>; onUndo: (change: AutoApplied, index: number) => void;
}) {
  return <section className="flex min-w-0 flex-col gap-2 text-offwhite">
    <Heading level={headingLevel} className="font-heading text-sm font-bold">Deep find changed these automatically</Heading>
    <ul className="flex min-w-0 flex-col gap-2">
      {changes.map((change, index) => <li key={`${change.table}:${change.id}:${change.field}:${index}`} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-surface/50 p-3">
        <p className="min-w-0 flex-1 break-words text-sm">{change.table === 'leads' ? 'Lead' : 'Contact'} {change.field.replace(/_/g, ' ')}: {String(change.before ?? '') || 'blank'} → {String(change.after)}</p>
        <Button variant="secondary" disabled={busy || !!notices[index]} aria-label={`Undo ${change.field.replace(/_/g, ' ')} change: ${shortValue(change.before) || 'blank'} to ${shortValue(change.after)}`} onClick={() => onUndo(change, index)}>Undo</Button>
        {notices[index] && <p className="w-full text-[13px]">{notices[index]}</p>}
      </li>)}
    </ul>
  </section>;
}

/** Generic, session-only Undo shared by automatic website and contact changes. */
export function DeepFindAutoChanges({ leadId, changes, headingLevel = 3 }: { leadId: string; changes: AutoApplied[]; headingLevel?: number }) {
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
    <p ref={status} tabIndex={-1} role="status" className="text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line">{busy ? 'Undoing…' : Object.values(notices).at(-1) ?? ''}</p>
    <AutoChangeRows headingLevel={headingLevel} changes={changes} busy={busy} notices={notices} onUndo={(change, index) => void undo(change, index)} />
    {error && <p role="alert" className="text-sm font-semibold text-danger-strong">{error}</p>}
  </div>;
}
