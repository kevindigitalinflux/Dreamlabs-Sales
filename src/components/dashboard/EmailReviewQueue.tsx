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
}

/** Drafts awaiting review — sequence output + manual saves. Nothing sends without a click. */
export function EmailReviewQueue({ drafts, loading, onReview, onChanged }: EmailReviewQueueProps) {
  if (loading) return <Skeleton className="h-20 w-full" />;
  if (drafts.length === 0) {
    return <EmptyState icon={MailCheck} title="No emails waiting for review" hint="Sequence drafts and saved drafts appear here for you to approve." />;
  }
  async function discard(id: string) {
    await supabase.from('email_logs').delete().eq('id', id);
    onChanged();
  }
  return (
    <ul className="flex flex-col gap-2">
      {drafts.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
          <span className="font-heading text-sm font-bold">{d.lead?.business_name ?? d.to_email}</span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.sequence_enrollment_id ? 'bg-violet/25 text-offwhite' : 'bg-surface text-muted'}`}>
            {d.sequence_enrollment_id ? 'Sequence' : 'Manual'}
          </span>
          <span className="w-full truncate text-sm text-muted sm:w-auto sm:flex-1">{d.subject}</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => void discard(d.id)} aria-label="Discard draft" className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-muted hover:text-red-400"><Trash2 className="h-4 w-4" aria-hidden /></button>
            <Button variant="secondary" onClick={() => onReview(d)}>Review &amp; send</Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
