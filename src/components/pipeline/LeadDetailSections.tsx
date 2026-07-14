import { useEffect, useState } from 'react';
import { History, Mail, Repeat } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatShortDate } from '../../lib/utils';
import type { LeadNote } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';

interface EmailLogRow {
  id: string;
  subject: string;
  status: string;
  sent_at: string;
}

/** Emails sent to this lead (cycle 2 fills this — table exists and is queried for real). */
export function EmailLogSection({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<EmailLogRow[] | null>(null);
  useEffect(() => {
    void supabase
      .from('email_logs').select('id, subject, status, sent_at').eq('lead_id', leadId).order('sent_at', { ascending: false })
      .then(({ data }) => setRows((data as EmailLogRow[] | null) ?? []));
  }, [leadId]);

  if (rows === null) return <Skeleton className="h-16 w-full" />;
  if (rows.length === 0) {
    return <EmptyState icon={Mail} title="No emails yet" hint="Email drafting and sending arrives with the Email Automation module (cycle 2)." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3 text-sm">
          <span className="truncate font-semibold">{r.subject}</span>
          <span className="shrink-0 text-xs text-muted">{r.status} · {formatShortDate(r.sent_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Active sequence enrollments (cycle 2 feature — empty state until then). */
export function SequencesSection({ leadId }: { leadId: string }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void supabase
      .from('sequence_enrollments').select('id', { count: 'exact', head: true }).eq('lead_id', leadId)
      .then(({ count: c }) => setCount(c ?? 0));
  }, [leadId]);

  if (count === null) return <Skeleton className="h-16 w-full" />;
  return <EmptyState icon={Repeat} title={count === 0 ? 'Not enrolled in any sequence' : `${count} enrollment(s)`} hint="Sequence enrollment arrives with the Email Automation module (cycle 2)." />;
}

/** Auto-logged stage changes, pulled from the notes stream. */
export function ActivityHistory({ notes, loading }: { notes: LeadNote[]; loading: boolean }) {
  if (loading) return <Skeleton className="h-16 w-full" />;
  const changes = notes.filter((n) => n.note_type === 'general' && n.content.startsWith('Stage changed:'));
  if (changes.length === 0) return <p className="text-sm text-muted">No stage changes yet.</p>;
  return (
    <ol className="flex flex-col gap-1">
      {changes.map((n) => (
        <li key={n.id} className="flex items-center gap-2 text-sm text-muted">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {n.content} · {formatShortDate(n.created_at)}
        </li>
      ))}
    </ol>
  );
}
