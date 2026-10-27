import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useReplyAlerts } from '../../hooks/useReplyAlerts';
import type { EmailReply } from '../../lib/replies';
import { Button } from '../ui/Button';
import { EmailComposer } from './EmailComposer';

/** Plain-text reply review; AI and handwritten answers always open the editable composer. */
export function ReplyDetail({ reply, onChanged }: { reply: EmailReply; onChanged: () => void }) {
  const { alerts, markRead } = useReplyAlerts();
  const [answer, setAnswer] = useState<{ subject: string; body: string; logId?: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const markedRead = useRef<string | null>(null);
  useEffect(() => {
    if (markedRead.current === reply.id) return;
    markedRead.current = reply.id;
    void markRead(reply.id).then(problem => { if (problem) setError(problem); });
  }, [reply.id, alerts, markRead]);
  async function draft() {
    setBusy(true); setError(null);
    try {
      if (reply.draft?.status === 'draft') setAnswer({ subject: reply.draft.subject, body: reply.draft.body, logId: reply.draft.id });
      else {
        const { data, error: invokeError } = await supabase.functions.invoke('draft-reply', { body: { reply_id: reply.id } });
        if (invokeError || typeof data?.subject !== 'string' || typeof data?.body !== 'string') throw new Error('Answer draft failed');
        setAnswer({ subject: data.subject, body: data.body });
      }
    } catch { console.error('replies: answer draft failed'); setError('Could not draft an answer. Check your organisation’s AI settings or write your own.'); }
    finally { setBusy(false); }
  }
  async function act(kind: 'handled' | 'opt_out') {
    setBusy(true); setError(null);
    try {
      if (kind === 'handled') {
        const { data, error: actionError } = await supabase.rpc('reply_mark_handled', { target_reply: reply.id });
        if (actionError || data !== true) throw new Error('Handling failed');
      } else {
        const { error: actionError } = await supabase.from('leads').update({ opted_out: true }).eq('id', reply.lead_id).select('id').single();
        if (actionError) throw new Error('Opt out failed');
      }
      await markRead(reply.id); onChanged();
    } catch { console.error('replies: review action failed'); setError('Could not save this change. You may need edit access to this lead.'); }
    finally { setBusy(false); }
  }
  return <article className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-card p-4">
    <h2 className="break-words text-lg font-bold">{reply.lead?.business_name ?? 'Lead'} — {reply.subject || 'Reply'}</h2>
    <p className="break-all text-sm text-muted">{reply.from_email} · {new Date(reply.received_at).toLocaleString('en-GB')}</p>
    {reply.opt_out_suspected && <p className="text-sm font-semibold text-offwhite">Possible opt-out request. Review it before changing the lead.</p>}
    {reply.handled_at && <p className="text-sm font-semibold">Handled</p>}
    <p className="whitespace-pre-wrap break-words text-sm">{reply.body}</p>
    {reply.attachment_count > 0 && <p className="text-sm text-muted">{reply.attachment_count} attachments — open your inbox to view them.</p>}
    {reply.original && <details className="rounded-lg border border-line p-3"><summary className="min-h-11 cursor-pointer font-semibold">Email this answers: {reply.original.subject}</summary>
      <p className="text-xs text-muted">Sent {new Date(reply.original.sent_at).toLocaleString('en-GB')}</p><p className="whitespace-pre-wrap break-words text-sm">{reply.original.body}</p></details>}
    <Link className="underline" to={`/pipeline/leads/${reply.lead_id}`}>Open lead</Link>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void draft()} disabled={busy || !reply.message_id}>{reply.draft?.status === 'draft' ? 'Review AI draft' : 'Draft an answer with AI'}</Button>
      <Button variant="secondary" disabled={busy || !reply.message_id} onClick={() => setAnswer({ subject: /^re:/i.test(reply.subject ?? '') ? reply.subject! : `Re: ${reply.subject ?? ''}`, body: '' })}>Write my own</Button>
      {reply.opt_out_suspected && !reply.lead?.opted_out && <Button variant="secondary" disabled={busy} onClick={() => void act('opt_out')}>Mark as opted out</Button>}
      <Button variant="secondary" disabled={busy || !!reply.handled_at} onClick={() => void act('handled')}>Mark handled</Button>
    </div>
    {!reply.message_id && <p className="text-sm text-muted">This older reply has no threading details. Answer it in your inbox.</p>}
    {answer && reply.lead && reply.original && <EmailComposer key={reply.id} open lead={reply.lead} onClose={() => { setAnswer(null); onChanged(); }}
      answer={{ replyId: reply.id, to_email: reply.original.to_email, ...answer }} />}
  </article>;
}
