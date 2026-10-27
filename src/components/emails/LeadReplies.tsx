import { Link } from 'react-router';
import { useReplies } from '../../hooks/useReplies';
/** A short lead-page summary; opening a reply in Emails marks its alert read. */
export function LeadReplies({ leadId }: { leadId: string }) {
  const { rows, error, loading } = useReplies(leadId);
  return <section className="rounded-xl border border-line bg-card p-4" aria-label="Lead replies">
    <h2 className="mb-2 text-lg font-bold">Replies</h2>
    {loading ? <p>Loading replies…</p> : error ? <p role="alert">{error}</p> : !rows.length ? <p className="text-sm text-muted">No replies recorded.</p>
      : <ul className="flex flex-col gap-2">{rows.slice(0, 3).map(reply => <li key={reply.id}><Link className="block break-words underline" to={`/emails?tab=replies&reply=${reply.id}`}>{reply.preview || reply.subject || 'Open reply'}</Link></li>)}</ul>}
  </section>;
}
