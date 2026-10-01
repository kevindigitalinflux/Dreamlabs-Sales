import { useEffect, useMemo, useState } from 'react';
import { Send, Sparkles, WandSparkles } from 'lucide-react';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AttachmentFiles } from './AttachmentFiles';
import type { EmailAttachment } from '../../lib/emailAttachments';

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
  /** When reviewing an existing draft from the queue — carries who it was
   * actually written for, so the composer can correctly re-select that
   * recipient instead of defaulting to the lead's own email (see the
   * effect below, which seeds `selectedRecipients` from these fields once
   * `decisionMakers` has loaded). */
  draft?: { log_id: string; subject: string; body: string; to_email: string; decision_maker_candidate_id: string | null; attachments?: EmailAttachment[] } | null;
}

type StatusMsg = { kind: 'ok' | 'warn' | 'err'; text: string };

/** A selectable send target: the lead's own email, or one of its decision-makers. */
interface Recipient { key: string; email: string; label: string; candidateId: string | null; name: string | null }

/** Draft-email modal: template → optional AI personalisation with diff → edit → send to one or more recipients. */
export function EmailComposer({ lead, open, onClose, draft = null }: EmailComposerProps) {
  const { templates } = useTemplates();
  const { currentOrg } = useOrg();
  const [templateId, setTemplateId] = useState('');
  const [subject, setSubject] = useState(draft?.subject ?? '');
  const [body, setBody] = useState(draft?.body ?? '');
  const [baseBody, setBaseBody] = useState<string | null>(null); // pre-AI body for the diff
  const [showDiff, setShowDiff] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState<'load' | 'ai' | 'send' | 'save' | null>(null);
  const [msg, setMsg] = useState<StatusMsg | null>(null);
  const [decisionMakers, setDecisionMakers] = useState<DecisionMakerCandidate[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set(lead.email ? ['lead'] : []));
  // Files this email carries: the template's (set when it is loaded), a stored draft's own, plus anything added here.
  const [attachments, setAttachments] = useState<EmailAttachment[]>(draft?.attachments ?? []);

  useEffect(() => {
    let cancelled = false;
    // While reviewing an existing draft, don't guess a default selection
    // until decisionMakers has loaded (below) — the draft's own
    // to_email/decision_maker_candidate_id are the source of truth for who
    // it was actually written for, and checking decision_maker_candidate_id
    // against the loaded list is what tells us it's still a valid, current
    // recipient (see C1 in the 2026-09-28 final review).
    setSelectedRecipients(draft ? new Set() : new Set(lead.email ? ['lead'] : []));
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', lead.id).not('email', 'is', null).then(({ data }) => {
      if (cancelled) return;
      const dms = (data as DecisionMakerCandidate[]) ?? [];
      setDecisionMakers(dms);
      if (draft) {
        if (draft.decision_maker_candidate_id && dms.some((d) => d.id === draft.decision_maker_candidate_id)) {
          setSelectedRecipients(new Set([draft.decision_maker_candidate_id]));
        } else if (draft.to_email === lead.email) {
          setSelectedRecipients(new Set(['lead']));
        } else if ((lead.additional_emails ?? []).includes(draft.to_email)) {
          setSelectedRecipients(new Set([`extra:${draft.to_email}`]));
        }
        // else: the draft's recipient is neither the lead nor a still-known
        // decision-maker (e.g. the candidate row was later removed) — leave
        // nothing pre-selected rather than defaulting to the wrong person.
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, draft?.log_id, draft?.to_email, draft?.decision_maker_candidate_id]);

  const recipients: Recipient[] = useMemo(() => {
    const list: Recipient[] = [];
    if (lead.email) list.push({ key: 'lead', email: lead.email, label: `${lead.owner_name ?? lead.business_name} (${lead.email})`, candidateId: null, name: lead.owner_name ?? null });
    // Extra addresses kept from Fill missing details (never the primary again).
    for (const extra of lead.additional_emails ?? []) {
      if (extra.toLowerCase() === lead.email?.toLowerCase()) continue;
      list.push({ key: `extra:${extra}`, email: extra, label: `${extra} (additional)`, candidateId: null, name: null });
    }
    for (const dm of decisionMakers) {
      if (!dm.email) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || null;
      list.push({ key: dm.id, email: dm.email, label: `${name ?? 'Unknown'}${dm.title ? ` — ${dm.title}` : ''} (${dm.email})`, candidateId: dm.id, name });
    }
    return list;
  }, [lead, decisionMakers]);

  const selectedTargets = useMemo(() => recipients.filter((r) => selectedRecipients.has(r.key)), [recipients, selectedRecipients]);

  function toggleRecipient(key: string) {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const diff = useMemo(() => (baseBody !== null && showDiff ? diffLines(baseBody, body) : null), [baseBody, body, showDiff]);

  async function generate(useAi: boolean) {
    if (!templateId) return setMsg({ kind: 'err', text: 'Pick a template first.' });
    setBusy(useAi ? 'ai' : 'load'); setMsg(null);
    // Only override the greeting when exactly one decision-maker (not the
    // lead, not a mixed/multi selection) is checked — matches
    // BulkDraftModal's own per-recipient personalisation. A mixed or empty
    // selection keeps the existing lead-owner greeting, since one drafted
    // body is shared across every checked recipient (see I4 in the
    // 2026-09-28 final review).
    const single = selectedTargets.length === 1 && selectedTargets[0]!.candidateId ? selectedTargets[0]! : null;
    const { data, error } = await supabase.functions.invoke('generate-email', {
      body: { lead_id: lead.id, template_id: templateId, use_ai: useAi, recipient_name: single?.name ?? undefined },
    });
    if (error) {
      const text = await readableInvokeError(error);
      setBusy(null);
      return setMsg({ kind: 'err', text });
    }
    setBusy(null);
    const r = data as { subject: string; body: string; ai_used: boolean; missing: string[]; attachments?: EmailAttachment[]; error?: string };
    if (r.error) return setMsg({ kind: 'err', text: r.error });
    setAttachments(r.attachments ?? []);
    if (useAi && !r.ai_used) setMsg({ kind: 'warn', text: 'AI unavailable — using the plain template instead.' });
    if (useAi) { setBaseBody(body || null); setShowDiff(true); } else { setBaseBody(r.body); setShowDiff(false); }
    setSubject(r.subject); setBody(r.body); setMissing(r.missing);
  }

  async function send(asDraft: boolean) {
    const targets = selectedTargets;
    if (targets.length === 0) return setMsg({ kind: 'err', text: 'Select at least one recipient.' });
    if (!subject.trim() || !body.trim()) return setMsg({ kind: 'err', text: 'Subject and body are required.' });
    setBusy(asDraft ? 'save' : 'send'); setMsg(null);
    let succeeded = 0;
    let firstFailReason: string | null = null;
    for (const target of targets) {
      if (asDraft) {
        const { error } = await supabase.from('email_logs').insert({
          lead_id: lead.id, to_email: target.email, subject, body, status: 'draft', attachments,
          decision_maker_candidate_id: target.candidateId,
          sent_by: (await supabase.auth.getUser()).data.user?.id,
          org_id: currentOrg?.id,
        });
        if (error) { if (!firstFailReason) firstFailReason = error.message; continue; }
        succeeded++;
        continue;
      }
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to_email: target.email, subject, body, lead_id: lead.id,
          decision_maker_candidate_id: target.candidateId, attachments,
          log_id: targets.length === 1 ? draft?.log_id : undefined,
        },
      });
      if (error) { if (!firstFailReason) firstFailReason = await readableInvokeError(error); continue; }
      const r = data as { ok?: boolean; error?: string };
      if (r.error) { if (!firstFailReason) firstFailReason = r.error; continue; }
      succeeded++;
    }
    setBusy(null);
    if (succeeded === targets.length) {
      setMsg({ kind: 'ok', text: asDraft ? 'Saved to your review queue.' : (targets.length > 1 ? `Sent to ${succeeded} recipients ✓` : 'Sent ✓') });
      if (!asDraft) setTimeout(onClose, 800);
    } else {
      setMsg({ kind: 'err', text: `${succeeded} of ${targets.length} succeeded${firstFailReason ? ` — ${firstFailReason}` : ''}` });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Email — ${lead.business_name}`}>
      <div className="flex flex-col gap-4">
        {recipients.length === 0 && <p role="alert" className="text-sm text-danger">No email addresses available for this lead or its decision-makers.</p>}
        {recipients.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold text-muted">Send to</p>
            {recipients.map((r) => (
              <label key={r.key} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedRecipients.has(r.key)} onChange={() => toggleRecipient(r.key)} className="h-4 w-4 accent-violet-500" />
                {r.label}
              </label>
            ))}
            {selectedRecipients.size > 1 && (
              <p className="text-xs text-muted">The greeting is shared across all selected recipients when personalising with AI.</p>
            )}
          </div>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void generate(false)} disabled={busy !== null} loading={busy === 'load'}>{busy === 'load' ? 'Loading…' : 'Use template'}</Button>
          <Button onClick={() => void generate(true)} disabled={busy !== null} loading={busy === 'ai'}>
            <Sparkles className="h-4 w-4" aria-hidden />{busy === 'ai' ? 'Personalising…' : 'Personalise with AI'}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-warning">No value for: {missing.map((m) => `{{${m}}}`).join(', ')} — those spots are blank, check the draft reads well.</p>
        )}
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        {diff && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs">
            <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted"><WandSparkles className="h-3.5 w-3.5" aria-hidden />Template → AI changes</p>
            {diff.map((l, i) => (
              <p key={i} className={`whitespace-pre-wrap ${l.kind === 'added' ? 'text-success' : l.kind === 'removed' ? 'text-danger/70 line-through' : 'text-muted/60'}`}>{l.text || ' '}</p>
            ))}
            <button type="button" onClick={() => setShowDiff(false)} className="mt-1 flex min-h-11 cursor-pointer items-center text-cyan">Hide diff</button>
          </div>
        )}
        <Textarea label="Body (plain text — lands in inboxes better)" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
        {currentOrg && <AttachmentFiles orgId={currentOrg.id} attachments={attachments} onChange={setAttachments} compact />}
        {msg && (
          <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-danger' : msg.kind === 'warn' ? 'text-warning' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => void send(true)} disabled={busy !== null} loading={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save as draft'}</Button>
          <Button onClick={() => void send(false)} disabled={busy !== null || selectedRecipients.size === 0} loading={busy === 'send'}>
            <Send className="h-4 w-4" aria-hidden />
            {busy === 'send'
              ? 'Sending…'
              : selectedTargets.length > 1
                ? `Send to ${selectedTargets.length} recipients`
                : selectedTargets.length === 1
                  ? `Send to ${selectedTargets[0]!.email}`
                  : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
