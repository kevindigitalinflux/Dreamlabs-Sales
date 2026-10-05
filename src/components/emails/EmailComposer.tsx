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
import { InsertLink } from './InsertLink';
import { RecipientDraftCard } from './RecipientDraftCard';
import { categoryLabel, compareByCategory } from '../../lib/categories';
import { BLANK_DRAFT, SEED_KEY, firstIncompleteDraft, patchDraft, unionMissing } from '../../lib/composerDrafts';
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

/** A selectable send target: the lead's own email, an additional address, or one of its decision-makers. */
interface Recipient { key: string; email: string; label: string; candidateId: string | null; name: string | null; title: string | null }

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
  const [decisionMakers, setDecisionMakers] = useState<DecisionMakerCandidate[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set(lead.email ? ['lead'] : []));

  useEffect(() => {
    let cancelled = false;
    // While reviewing an existing draft, don't guess a default selection
    // until decisionMakers has loaded (below) — the draft's own
    // to_email/decision_maker_candidate_id are the source of truth for who
    // it was actually written for, and checking decision_maker_candidate_id
    // against the loaded list is what tells us it's still a valid, current
    // recipient (see C1 in the 2026-09-28 final review).
    setSelectedRecipients(draft ? new Set() : new Set(lead.email ? ['lead'] : []));
    void supabase.from('decision_maker_candidates').select('*').eq('lead_id', lead.id).not('email', 'is', null).is('dismissed_at', null).then(({ data }) => {
      if (cancelled) return;
      const dms = (data as DecisionMakerCandidate[]) ?? [];
      setDecisionMakers(dms);
      if (draft) {
        let key: string | null = null;
        if (draft.decision_maker_candidate_id && dms.some((d) => d.id === draft.decision_maker_candidate_id)) key = draft.decision_maker_candidate_id;
        else if (draft.to_email === lead.email) key = 'lead';
        else if ((lead.additional_emails ?? []).includes(draft.to_email)) key = `extra:${draft.to_email}`;
        // else: the draft's recipient is neither the lead nor a still-known
        // decision-maker (e.g. the candidate row was later removed) — leave
        // nothing pre-selected rather than defaulting to the wrong person.
        if (key) {
          const resolved = key;
          setSelectedRecipients(new Set([resolved]));
          setDrafts((prev) => (prev[SEED_KEY] ? { ...prev, [resolved]: prev[SEED_KEY]! } : prev));
        }
      }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id, draft?.log_id, draft?.to_email, draft?.decision_maker_candidate_id]);

  const recipients: Recipient[] = useMemo(() => {
    const list: Recipient[] = [];
    if (lead.email) list.push({ key: 'lead', email: lead.email, label: `${lead.owner_name ?? lead.business_name} (${lead.email})`, candidateId: null, name: lead.owner_name ?? null, title: null });
    // Extra addresses kept from Fill missing details (never the primary again).
    for (const extra of lead.additional_emails ?? []) {
      if (extra.toLowerCase() === lead.email?.toLowerCase()) continue;
      list.push({ key: `extra:${extra}`, email: extra, label: `${extra} (additional)`, candidateId: null, name: null, title: null });
    }
    for (const dm of decisionMakers) {
      if (!dm.email) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || null;
      list.push({ key: dm.id, email: dm.email, label: `${name ?? 'Unknown'}${dm.title ? ` — ${dm.title}` : ''} (${dm.email})`, candidateId: dm.id, name, title: dm.title });
    }
    return list;
  }, [lead, decisionMakers]);

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
          recipient_name: t?.candidateId ? (t.name ?? undefined) : undefined,
          recipient_title: t?.candidateId ? (t.title ?? undefined) : undefined,
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
            {multi && (
              <p className="text-xs text-muted">Each person you tick gets their own email, written for them. You can edit each one below.</p>
            )}
          </div>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {[...templates].sort(compareByCategory).map((t) => <option key={t.id} value={t.id}>{categoryLabel(t.name, t.category)}</option>)}
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
