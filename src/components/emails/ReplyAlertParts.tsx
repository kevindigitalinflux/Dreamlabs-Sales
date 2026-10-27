import { useState } from 'react';
import { Link } from 'react-router';
import { useReplyAlerts } from '../../hooks/useReplyAlerts';

/** Explicit accessible count shared by desktop and mobile navigation. */
export function ReplyCountBadge({ count }: { count: number }) {
  return count > 0 ? <span aria-label={`${count} unread replies`} className="rounded-full bg-purple px-2 py-0.5 text-xs font-bold text-on-accent">{count}</span> : null;
}
/** Session-only dismissal resets when a new reply arrives. */
export function ReplyBanner() {
  const { alerts, count } = useReplyAlerts();
  const [dismissed, setDismissed] = useState('');
  const key = alerts.map(a => a.reply_id).sort().join(':');
  if (!count || key === dismissed) return null;
  const first = alerts[0]?.reply;
  return <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm" role="status">
    <Link className="min-w-0 flex-1 break-words underline" to="/emails?tab=replies">{count} new {count === 1 ? 'reply' : 'replies'}{first ? ` — ${first.lead?.business_name ?? 'Lead'}: ${first.preview.split('\n')[0]}` : ''}</Link>
    <button type="button" className="min-h-11 px-2" onClick={() => setDismissed(key)} aria-label="Dismiss new replies banner">Dismiss</button>
  </div>;
}
