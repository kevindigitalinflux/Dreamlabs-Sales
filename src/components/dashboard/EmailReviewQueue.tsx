import { MailCheck, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { DraftLog } from '../../hooks/useDrafts';
import { Button } from '../ui/Button';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailReviewQueueProps {
  drafts: DraftLog[];
  loading: boolean;
  onReview: (draft: DraftLog) => void;
  onChanged: () => void;
  /** Optional multi-select — when all three are provided, a header
   * "select all" row and a per-row checkbox render alongside the existing
   * content. Omitted entirely by the Dashboard's own usage, which renders
   * exactly as before. */
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  /** Disables the select-all and per-row checkboxes without hiding them —
   * for use while a caller's own bulk action (e.g. a release in progress)
   * is running, so a mid-flight toggle can't be silently ignored and then
   * wiped once the action completes. Has no effect unless `selected` etc.
   * are also provided. */
  selectionDisabled?: boolean;
}

/** Drafts awaiting review — sequence output + manual saves. Nothing sends without a click. */
export function EmailReviewQueue({ drafts, loading, onReview, onChanged, selected, onToggle, onToggleAll, selectionDisabled }: EmailReviewQueueProps) {
  if (loading) return <Skeleton className="h-20 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState icon={MailCheck} title="No emails waiting for review" hint="Sequence drafts and saved drafts appear here for you to approve." />;
  }
  async function discard(id: string) {
    await supabase.from('email_logs').delete().eq('id', id);
    onChanged();
  }
  const selectable = selected !== undefined && onToggle !== undefined && onToggleAll !== undefined;
  return (
    <ul className="flex flex-col gap-2">
      {selectable && (
        <li className="flex items-center gap-2 px-1">
          <input type="checkbox" checked={drafts.length > 0 && selected.size === drafts.length} onChange={onToggleAll} disabled={selectionDisabled} className="h-4 w-4 accent-violet-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Select all" />
          <span className="text-xs font-semibold text-muted">Select all</span>
        </li>
      )}
      {drafts.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
          {selectable && (
            <input type="checkbox" checked={selected.has(d.id)} onChange={() => onToggle(d.id)} disabled={selectionDisabled} className="h-4 w-4 accent-violet-500 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Select ${d.lead?.business_name ?? d.to_email}`} />
          )}
          <span className="font-heading text-sm font-bold">{d.lead?.business_name ?? d.to_email}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.sequence_enrollment_id ? 'bg-violet/25 text-offwhite' : 'bg-surface text-muted'}`}>
            {d.sequence_enrollment_id ? 'Sequence' : 'Manual'}
          </span>
          {d.status === 'failed' && (
            <span title={d.error_message ?? 'Send failed'} className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-danger">
              Failed — retry
            </span>
          )}
          <span className="w-full truncate text-sm text-muted sm:w-auto sm:flex-1">{d.subject}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void discard(d.id)} aria-label="Discard draft" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-danger"><Trash2 className="h-4 w-4" aria-hidden /></button>
            <Button variant="secondary" onClick={() => onReview(d)}>Review &amp; send</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
