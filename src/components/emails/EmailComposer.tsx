import { useMemo, useState } from 'react';
import { Send, Sparkles, WandSparkles } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTemplates } from '../../hooks/useTemplates';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';

interface DiffLine { kind: 'same' | 'removed' | 'added'; text: string }

/** Line-level LCS diff for the template → AI-draft comparison. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) {
    for (let j = B.length - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ kind: 'same', text: A[i]! }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'removed', text: A[i]! }); i++; }
    else { out.push({ kind: 'added', text: B[j]! }); j++; }
  }
  while (i < A.length) out.push({ kind: 'removed', text: A[i++]! });
  while (j < B.length) out.push({ kind: 'added', text: B[j++]! });
  return out;
}

interface EmailComposerProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  /** When reviewing an existing draft from the queue. */
  draft?: { log_id: string; subject: string; body: string } | null;
}

type StatusMsg = { kind: 'ok' | 'warn' | 'err'; text: string };

/**
 * supabase-js throws a generic "Edge Function returned a non-2xx status code" for any
 * failed invoke — the readable `{ error }` body our functions send back lives on
 * `error.context`, a Fetch `Response`. Unwrap it so the user sees the real reason
 * (e.g. the send-email settings-gate message) instead of the generic wrapper text.
 */
async function readableInvokeError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body.error) return body.error;
    } catch {
      // Body wasn't JSON — fall through to the generic message below.
    }
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Draft-email modal: template → optional AI personalisation with diff → edit → send. */
export function EmailComposer({ lead, open, onClose, draft = null }: EmailComposerProps) {
  const { templates } = useTemplates();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [baseBody, setBaseBody] = useState<string | null>(null); // pre-AI body for the diff
  const [showDiff, setShowDiff] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<'load' | 'ai' | 'send' | 'save' | null>(null);
  const [msg, setMsg] = useState<StatusMsg | null>(null);

  const diff = useMemo(() => (baseBody !== null && showDiff ? diffLines(baseBody, body) : null), [baseBody, body, showDiff]);

  async function generate(useAi: boolean) {
    if (!templateId) return setMsg({ kind: 'err', text: 'Pick a template first.' });
    setBusy(useAi ? 'ai' : 'load'); setMsg(null);
    const { data, error } = await supabase.functions.invoke('generate-email', {
      body: { lead_id: lead.id, template_id: templateId, use_ai: useAi },
    });
    setBusy(null);
    if (error) return setMsg({ kind: 'err', text: await readableInvokeError(error) });
    const r = data as { subject: string; body: string; ai_used: boolean; missing: string[]; error?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    if (useAi && !r.ai_used) setMsg({ kind: 'warn', text: 'AI unavailable — using the plain template instead.' });
    if (useAi) { setBaseBody(body || null); setShowDiff(true); } else { setBaseBody(r.body); setShowDiff(false); }
    setSubject(r.subject); setBody(r.body); setMissing(r.missing);
  }

  async function send(asDraft: boolean) {
    if (!lead.email) return setMsg({ kind: 'err', text: 'This lead has no email address — add one first.' });
    if (!subject.trim() || !body.trim()) return setMsg({ kind: 'err', text: 'Subject and body are required.' });
    setBusy(asDraft ? 'save' : 'send'); setMsg(null);
    if (asDraft) {
      const { error } = await supabase.from('email_logs').insert({
        lead_id: lead.id, to_email: lead.email, subject, body, status: 'draft',
        sent_by: (await supabase.auth.getUser()).data.user?.id,
      });
      setBusy(null);
      if (error) return setMsg({ kind: 'err', text: error.message });
      setMsg({ kind: 'ok', text: 'Saved to your review queue.' });
      return;
    }
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: { to_email: lead.email, subject, body, lead_id: lead.id, log_id: draft?.log_id },
    });
    setBusy(null);
    if (error) return setMsg({ kind: 'err', text: await readableInvokeError(error) });
    const r = data as { ok?: boolean; error?: string; warning?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    if (r.warning) { setMsg({ kind: 'warn', text: `Sent ✓ — ${r.warning}` }); setTimeout(onClose, 1200); return; }
    setMsg({ kind: 'ok', text: 'Sent ✓' });
    setTimeout(onClose, 800);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Email — ${lead.business_name}`}>
      <div className="flex flex-col gap-4">
        {!lead.email && <p role="alert" className="text-sm text-red-400">This lead has no email address.</p>}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void generate(false)} disabled={busy !== null}>{busy === 'load' ? 'Loading…' : 'Use template'}</Button>
          <Button onClick={() => void generate(true)} disabled={busy !== null}>
            <Sparkles className="h-4 w-4" aria-hidden />{busy === 'ai' ? 'Personalising…' : 'Personalise with AI'}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-amber-400">No value for: {missing.map((m) => `{{${m}}}`).join(', ')} — those spots are blank, check the draft reads well.</p>
        )}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        {diff && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted"><WandSparkles className="h-3.5 w-3.5" aria-hidden />Template → AI changes</p>
            {diff.map((l, i) => (
              <p key={i} className={`whitespace-pre-wrap ${l.kind === 'added' ? 'text-emerald-400' : l.kind === 'removed' ? 'text-red-400/70 line-through' : 'text-muted/60'}`}>{l.text || ' '}</p>
            ))}
            <button type="button" onClick={() => setShowDiff(false)} className="mt-2 cursor-pointer text-cyan">Hide diff</button>
          </div>
        )}
        <Textarea label="Body (plain text — lands in inboxes better)" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        {msg && (
          <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-red-400' : msg.kind === 'warn' ? 'text-amber-400' : 'text-emerald-400'}`}>
            {msg.text}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => void send(true)} disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save as draft'}</Button>
          <Button onClick={() => void send(false)} disabled={busy !== null || !lead.email}>
            <Send className="h-4 w-4" aria-hidden />{busy === 'send' ? 'Sending…' : `Send to ${lead.email ?? '—'}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
