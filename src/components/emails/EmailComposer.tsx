import { useEffect, useMemo, useState } from 'react';
import { Send, Sparkles, WandSparkles } from 'lucide-react';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { useLeadContacts } from '../../hooks/useLeadContacts';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Input, SelectField, Textarea } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { AttachmentFiles } from './AttachmentFiles';
import { InsertLink } from './InsertLink';
import { RecipientDraftCard } from './RecipientDraftCard';
import { RecipientPicker } from './RecipientPicker';
import { categorisedOptions } from '../ui/CategorisedOptions';
import { BLANK_DRAFT, SEED_KEY, firstIncompleteDraft, generationIdentity, patchDraft, unionMissing } from '../../lib/composerDrafts';
import { buildRecipients, defaultSelection, draftRecipientKey } from '../../lib/composerRecipients';
import type { RecipientDraft } from '../../lib/composerDrafts';
import { appendLinkToBody } from '../../lib/emailAttachments';
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

type GenerateResult = {
  subject: string; body: string; ai_used: boolean; missing: string[]; attachments?: EmailAttachment[]; error?: string;
};

/**
 * Draft-email modal: template → optional AI personalisation → edit → save or send.
 * Every recipient you tick gets their OWN email (written for them by name and, for a
 * decision-maker, by role) with its own subject, body and attachments, so a message to a
 * director and one to an office manager aren't the same text. With one recipient it looks
 * exactly as it always did.
 */
export function EmailComposer({ lead, open, onClose, draft = null }: EmailComposerProps) {
  const { templates } = useTemplates();
  const { currentOrg } = useOrg();
  const [templateId, setTemplateId] = useState('');
  // Source of truth for every email being written, keyed by recipient. A draft opened from
  // the review queue starts under SEED_KEY until its recipient is worked out (effect below).
  const [drafts, setDrafts] = useState<Record<string, RecipientDraft>>(() => {
    const initial: Record<string, RecipientDraft> = {};
    if (draft) initial[SEED_KEY] = { ...BLANK_DRAFT, subject: draft.subject, body: draft.body, attachments: draft.attachments ?? [] };
    return initial;
  });
  const [busy, setBusy] = useState<'load' | 'ai' | 'send' | 'save' | null>(null);
  const [msg, setMsg] = useState<StatusMsg | null>(null);
  const { contacts, loading: contactsLoading } = useLeadContacts(lead.id);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set(!draft && lead.email ? ['lead'] : []));
  const recipients = useMemo(() => buildRecipients(lead, contacts), [lead, contacts]);

  // Once the contacts have loaded, tick the main contact; or, when reviewing an existing draft, the
  // person it was actually written for (never guess a default for a draft whose recipient is gone).
  useEffect(() => {
    if (contactsLoading) return;
    if (!draft) { setSelectedRecipients(new Set(defaultSelection(recipients, contacts, lead.email))); return; }
    const key = draftRecipientKey(draft, recipients);
    setSelectedRecipients(new Set(key ? [key] : []));
    if (key) setDrafts((prev) => (prev[SEED_KEY] ? { ...prev, [key]: prev[SEED_KEY]! } : prev));
    // Re-seed only when the lead, the draft or the finished load changes, not on every realtime contact edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, draft?.log_id, draft?.to_email, draft?.decision_maker_candidate_id, contactsLoading]);

  const selectedTargets = useMemo(() => recipients.filter((r) => selectedRecipients.has(r.key)), [recipients, selectedRecipients]);
  const multi = selectedTargets.length > 1;
  // The email shown in the single editor: the one recipient's, or (nothing ticked yet) the seed/blank one.
  const shownKey = selectedTargets[0]?.key ?? SEED_KEY;
  const current = drafts[shownKey] ?? BLANK_DRAFT;
  const missing = unionMissing(selectedTargets.length > 0 ? selectedTargets : [{ key: SEED_KEY, email: '', name: null }], drafts);

  function update(key: string, patch: Partial<RecipientDraft>) {
    setDrafts((prev) => patchDraft(prev, key, patch));
  }

  function toggleRecipient(key: string) {
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const diff = useMemo(
    () => (current.baseBody !== null && current.showDiff ? diffLines(current.baseBody, current.body) : null),
    [current.baseBody, current.showDiff, current.body],
  );

  async function generate(useAi: boolean) {
    if (!templateId) return setMsg({ kind: 'err', text: 'Pick a template first.' });
    setBusy(useAi ? 'ai' : 'load'); setMsg(null);
    // One email per ticked recipient, written for them: a decision-maker's name becomes the
    // greeting, and their job title goes to the AI so it pitches to their role. The lead's own
    // address (and any extra one) keeps the lead's default contact. Nothing ticked yet writes
    // a generic one.
    const jobs = selectedTargets.length > 0 ? selectedTargets : [null];
    const results = await Promise.all(jobs.map(async (t) => {
      const key = t?.key ?? SEED_KEY;
      const { data, error } = await supabase.functions.invoke('generate-email', {
        body: {
          lead_id: lead.id, template_id: templateId, use_ai: useAi,
          ...generationIdentity(t),
        },
      });
      if (error) return { key, error: await readableInvokeError(error) };
      const r = data as GenerateResult;
      return r.error ? { key, error: r.error } : { key, result: r };
    }));
    setBusy(null);

    const firstError = results.find((x) => 'error' in x && x.error);
    let aiMissed = false;
    setDrafts((prev) => {
      let next = prev;
      for (const x of results) {
        if (!('result' in x) || !x.result) continue;
        const r = x.result;
        if (useAi && !r.ai_used) aiMissed = true;
        const before = next[x.key]?.body ?? '';
        next = patchDraft(next, x.key, {
          subject: r.subject, body: r.body, missing: r.missing, attachments: r.attachments ?? [],
          // With AI the diff compares what was there before to the AI text; without, the template is the baseline.
          baseBody: useAi ? (before || null) : r.body, showDiff: useAi,
        });
      }
      return next;
    });
    if (firstError && 'error' in firstError) {
      return setMsg({ kind: 'err', text: results.length > 1 ? `Couldn't write every email: ${firstError.error}` : String(firstError.error) });
    }
    if (useAi && aiMissed) setMsg({ kind: 'warn', text: 'AI unavailable — using the plain template instead.' });
    else if (multi) setMsg({ kind: 'ok', text: `Wrote ${results.length} emails, one for each person. Review each, then save or send.` });
  }

  async function send(asDraft: boolean) {
    const targets = selectedTargets;
    if (targets.length === 0) return setMsg({ kind: 'err', text: 'Select at least one recipient.' });
    const incomplete = firstIncompleteDraft(targets, drafts);
    if (incomplete) return setMsg({ kind: 'err', text: incomplete });
    setBusy(asDraft ? 'save' : 'send'); setMsg(null);
    let succeeded = 0;
    let firstFailReason: string | null = null;
    for (const target of targets) {
      // Each person's own subject, body and attachments, never a shared copy.
      const d = drafts[target.key]!;
      if (asDraft) {
        const { error } = await supabase.from('email_logs').insert({
          lead_id: lead.id, to_email: target.email, subject: d.subject, body: d.body, status: 'draft', attachments: d.attachments,
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
          to_email: target.email, subject: d.subject, body: d.body, lead_id: lead.id,
          decision_maker_candidate_id: target.candidateId, attachments: d.attachments,
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
      setMsg({ kind: 'ok', text: asDraft ? (targets.length > 1 ? `Saved ${succeeded} drafts to your review queue.` : 'Saved to your review queue.') : (targets.length > 1 ? `Sent ${succeeded} emails ✓` : 'Sent ✓') });
      if (!asDraft) setTimeout(onClose, 800);
    } else {
      setMsg({ kind: 'err', text: `${succeeded} of ${targets.length} succeeded${firstFailReason ? ` — ${firstFailReason}` : ''}` });
    }
  }

  const n = selectedTargets.length;

  return (
    <Modal open={open} onClose={onClose} title={`Email — ${lead.business_name}`}>
      <div className="flex flex-col gap-4">
        {recipients.length === 0 && <p role="alert" className="text-sm text-danger">No email addresses available for this lead or its contacts.</p>}
        {recipients.length > 0 && <RecipientPicker recipients={recipients} selected={selectedRecipients} onToggle={toggleRecipient} multi={multi} />}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} showGroupInValue>
          <option value="">Choose…</option>
          {categorisedOptions(templates, (t) => ({ value: t.id }))}
        </SelectField>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void generate(false)} disabled={busy !== null} loading={busy === 'load'}>
            {busy === 'load' ? 'Loading…' : multi ? `Use template for ${n} people` : 'Use template'}
          </Button>
          <Button onClick={() => void generate(true)} disabled={busy !== null} loading={busy === 'ai'}>
            <Sparkles className="h-4 w-4" aria-hidden />{busy === 'ai' ? 'Personalising…' : multi ? `Personalise ${n} with AI` : 'Personalise with AI'}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-xs text-warning">No value for: {missing.map((m) => `{{${m}}}`).join(', ')} — those spots are blank. You can set your own in Settings, Custom placeholders.</p>
        )}

        {multi ? (
          <div className="flex flex-col gap-3">
            {selectedTargets.map((t) => (
              <RecipientDraftCard
                key={t.key}
                name={t.name}
                kind={t.kind}
                title={t.title}
                email={t.email}
                draft={drafts[t.key] ?? BLANK_DRAFT}
                onChange={(patch) => update(t.key, patch)}
                orgId={currentOrg?.id}
              />
            ))}
          </div>
        ) : (
          <>
            <Input label="Subject" value={current.subject} onChange={(e) => update(shownKey, { subject: e.target.value })} />
            {currentOrg && (
              <div className="flex flex-col gap-4 rounded-lg border border-line p-3">
                <AttachmentFiles orgId={currentOrg.id} attachments={current.attachments} onChange={(attachments) => update(shownKey, { attachments })} compact />
                <InsertLink orgId={currentOrg.id} onInsert={(link) => update(shownKey, { body: appendLinkToBody(current.body, link) })} />
              </div>
            )}
            {diff && (
              <div className="max-h-48 overflow-y-auto rounded-lg bg-surface/60 p-3 text-xs">
                <p className="mb-1 flex items-center gap-1 font-bold uppercase tracking-wide text-muted"><WandSparkles className="h-3.5 w-3.5" aria-hidden />Template → AI changes</p>
                {diff.map((l, i) => (
                  <p key={i} className={`whitespace-pre-wrap ${l.kind === 'added' ? 'text-success' : l.kind === 'removed' ? 'text-danger/70 line-through' : 'text-muted/60'}`}>{l.text || ' '}</p>
                ))}
                <button type="button" onClick={() => update(shownKey, { showDiff: false })} className="mt-1 flex min-h-11 cursor-pointer items-center text-cyan">Hide diff</button>
              </div>
            )}
            <Textarea label="Body (plain text — lands in inboxes better)" rows={10} value={current.body} onChange={(e) => update(shownKey, { body: e.target.value })} />
          </>
        )}

        {msg && (
          <p role={msg.kind === 'err' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'err' ? 'text-danger' : msg.kind === 'warn' ? 'text-warning' : 'text-success'}`}>
            {msg.text}
          </p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => void send(true)} disabled={busy !== null} loading={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : multi ? `Save ${n} drafts` : 'Save as draft'}
          </Button>
          <Button onClick={() => void send(false)} disabled={busy !== null || selectedRecipients.size === 0} loading={busy === 'send'}>
            <Send className="h-4 w-4" aria-hidden />
            {busy === 'send'
              ? 'Sending…'
              : multi
                ? `Send ${n} emails`
                : n === 1
                  ? `Send to ${selectedTargets[0]!.email}`
                  : 'Send'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
