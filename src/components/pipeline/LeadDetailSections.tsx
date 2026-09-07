import { useEffect, useState } from 'react';
import { History, Mail, Phone, Repeat } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { formatShortDate } from '../../lib/utils';
import type { CallOutcome, LeadNote } from '../../types';
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

interface CallRow {
  id: string;
  provider: string;
  direction: 'outbound' | 'inbound';
  outcome: CallOutcome | null;
  duration_seconds: number | null;
  recording_url: string | null;
  created_at: string;
}

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: 'Answered',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
};

// calls.provider is free text (not constrained to DialerProvider like
// user_dialer_settings.provider), so known providers get DialerConfig's
// display casing and anything else falls back to a simple capitalize.
const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  justcall: 'JustCall',
  kixie: 'Kixie',
  aircall: 'Aircall',
};

function providerLabel(provider: string): string {
  return KNOWN_PROVIDER_LABELS[provider] ?? (provider.charAt(0).toUpperCase() + provider.slice(1));
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Calls logged for this lead via a connected power dialer (empty until a provider is connected and wired up). */
export function CallHistorySection({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  useEffect(() => {
    void supabase
      .from('calls').select('id, provider, direction, outcome, duration_seconds, recording_url, created_at').eq('lead_id', leadId).order('created_at', { ascending: false })
      .then(({ data }) => setRows((data as CallRow[] | null) ?? []));
  }, [leadId]);

  if (rows === null) return <Skeleton className="h-16 w-full" />;
  if (rows.length === 0) {
    return <EmptyState icon={Phone} title="No calls yet" hint="Calls made through a connected power dialer will appear here automatically." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between rounded-lg bg-surface/50 p-3 text-sm">
          <span className="truncate font-semibold">
            {r.direction === 'outbound' ? 'Outbound call' : 'Inbound call'}
            {r.outcome && ` · ${OUTCOME_LABELS[r.outcome]}`}
            {` · via ${providerLabel(r.provider)}`}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {formatDuration(r.duration_seconds)} {formatShortDate(r.created_at)}
            {r.recording_url && (
              <>
                {' · '}
                <a href={r.recording_url} target="_blank" rel="noreferrer" className="underline">Recording</a>
              </>
            )}
          </span>
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
