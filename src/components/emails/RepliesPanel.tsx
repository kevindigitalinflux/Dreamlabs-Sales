import { useSearchParams } from 'react-router';
import { useMemo, useState } from 'react';
import { useReplies } from '../../hooks/useReplies';
import { useReplyAlerts } from '../../hooks/useReplyAlerts';
import { orderReplies } from '../../lib/replyAlertsView';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import { ReplyDetail } from './ReplyDetail';
import { MailboxStatus } from '../settings/MailboxStatus';

/** The Replies tab stays inside Emails, with direct links to a single reply. */
export function RepliesPanel() {
  const [params, setParams] = useSearchParams(); const selected = params.get('reply');
  const { rows, error, loading, refresh } = useReplies(undefined, selected);
  const alerts = useReplyAlerts(); const [problem, setProblem] = useState<string | null>(null);
  const unread = useMemo(() => new Set(alerts.alerts.map(a => a.reply_id)), [alerts.alerts]);
  return <section className="flex min-w-0 flex-col gap-3" aria-label="Replies">
    <MailboxStatus warningOnly />
    {(error || problem || alerts.error) && <p role="alert" className="text-sm text-danger">{error || problem || alerts.error}</p>}
    <div className="flex flex-wrap gap-2">
      {selected && <Button variant="secondary" onClick={() => setParams({ tab: 'replies' })}>All replies</Button>}
      <Button variant="secondary" onClick={refresh}>Refresh replies</Button>
      <Button variant="secondary" disabled={!alerts.count} onClick={() => void alerts.markRead().then(setProblem)}>Mark all read</Button>
    </div>
    {loading ? <Skeleton className="h-32 w-full" /> : selected ? rows[0] ? <ReplyDetail reply={rows[0]} onChanged={refresh} /> : <p>Reply not found.</p>
      : rows.length === 0 ? <p className="text-sm text-muted">No replies yet. Connected inboxes are checked about every five minutes.</p>
      : <ul className="flex flex-col gap-2">{orderReplies(rows, unread).map(reply => <li key={reply.id}>
        <button type="button" onClick={() => setParams({ tab: 'replies', reply: reply.id })} className="flex min-h-11 w-full flex-col gap-1 rounded-lg border border-line bg-card p-3 text-left">
          <span className="break-words font-semibold">{unread.has(reply.id) && 'Unread · '}{reply.lead?.business_name ?? 'Lead'}</span>
          <span className="break-all text-xs text-muted">{reply.from_email} · {new Date(reply.received_at).toLocaleString('en-GB')}</span>
          <span className="break-words text-sm">{reply.preview || reply.body.slice(0, 200)}</span>
          <span className="text-xs font-semibold">{reply.draft?.status === 'draft' && 'AI draft ready · '}{reply.opt_out_suspected && 'Possible opt-out · '}{reply.handled_at && 'Handled'}</span>
        </button>
      </li>)}</ul>}
  </section>;
}
