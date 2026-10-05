import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
import { categoryLabel, compareByCategory } from '../../lib/categories';
import { buildBulkTargets, countOtherContacts } from '../../lib/bulkDraftTargets';
import type { BulkTarget } from '../../lib/bulkDraftTargets';
import type { EmailAttachment } from '../../lib/emailAttachments';
import type { DecisionMakerCandidate, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/Input';

interface BulkDraftModalProps {
  open: boolean;
  leads: Lead[];
  onClose: () => void;
  onGenerated?: () => void;
}

/** How many emails are written at once: enough to be quick, few enough not to hammer the AI. */
const CONCURRENCY = 3;

/**
 * Writes one email draft per person from a single shared template, each tailored to that
 * person (their name as the greeting, and a decision-maker's job title for the AI). Who gets
 * a draft is worked out and shown as soon as the dialog opens, so there are no surprises:
 * a company with three decision-makers gets three emails, not one. Reuses the generate-email
 * plus email_logs path the composer's own "Save as draft" uses.
 */
export function BulkDraftModal({ open, leads, onClose, onGenerated }: BulkDraftModalProps) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { templates } = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [decisionMakers, setDecisionMakers] = useState<DecisionMakerCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  // The modal stays mounted for the page's lifetime (Modal just returns null while closed), so
  // state would survive a close. Reset it on open, and look up the decision-makers found for
  // the selected leads right away, ticking "include" by default when there are others to write to.
  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setProgress(0);
    setIncludeOthers(false);
    setDecisionMakers([]);
    if (leads.length === 0) return;
    let cancelled = false;
    void supabase.from('decision_maker_candidates').select('*')
      .in('lead_id', leads.map((l) => l.id)).not('email', 'is', null).is('dismissed_at', null)
      .then(({ data }) => {
        if (cancelled) return;
        const found = (data as DecisionMakerCandidate[] | null) ?? [];
        setDecisionMakers(found);
        setIncludeOthers(countOtherContacts(leads, found) > 0);
      });
    return () => { cancelled = true; };
    // leads is the selection at open time; re-running on every parent render would reset the user's choices.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const targets = useMemo(() => buildBulkTargets(leads, decisionMakers, includeOthers), [leads, decisionMakers, includeOthers]);
  const otherCount = useMemo(() => countOtherContacts(leads, decisionMakers), [leads, decisionMakers]);
  const leadsWithoutAnyone = leads.filter((l) => !targets.some((t) => t.leadId === l.id));

  async function draftOne(target: BulkTarget): Promise<string | null> {
    const { data, error: invokeErr } = await supabase.functions.invoke('generate-email', {
      body: {
        lead_id: target.leadId, template_id: templateId, use_ai: useAi,
        // A decision-maker is addressed by name and written to by role; the lead's own contact keeps its default.
        recipient_name: target.name ?? undefined, recipient_title: target.title ?? undefined,
      },
    });
    if (invokeErr) return await readableInvokeError(invokeErr);
    const result = data as { subject?: string; body?: string; attachments?: EmailAttachment[]; error?: string } | null;
    if (!result || result.error || !result.subject || !result.body) return result?.error ?? 'Draft generation failed';
    const { error: insertErr } = await supabase.from('email_logs').insert({
      lead_id: target.leadId, to_email: target.email, subject: result.subject, body: result.body,
      status: 'draft', sent_by: session!.user.id, org_id: currentOrg!.id,
      decision_maker_candidate_id: target.candidateId,
      // The template's files go on each draft so releasing it later sends them too.
      attachments: result.attachments ?? [],
    });
    return insertErr ? insertErr.message : null;
  }

  async function handleGenerate() {
    if (!templateId || !currentOrg || !session) return;
    setBusy(true);
    setProgress(0);
    setSummary(null);
    let drafted = 0;
    let firstFailReason: string | null = null;
    // A few at a time: each person's email is its own AI call, so a big batch is much faster this way.
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY);
      const errors = await Promise.all(batch.map((t) => draftOne(t)));
      for (const err of errors) {
        if (err === null) drafted++; else if (!firstFailReason) firstFailReason = err;
      }
      setProgress(Math.min(targets.length, i + batch.length));
    }
    setBusy(false);
    const failed = targets.length - drafted;
    const parts = [`Drafted ${drafted} ${drafted === 1 ? 'email' : 'emails'}, one for each person`];
    if (leadsWithoutAnyone.length > 0) parts.push(`${leadsWithoutAnyone.length} ${leadsWithoutAnyone.length === 1 ? 'lead' : 'leads'} skipped (nobody to write to)`);
    if (failed > 0) parts.push(`${failed} failed to draft${firstFailReason ? ` (${firstFailReason})` : ''}`);
    setSummary(parts.join(' — '));
    if (drafted > 0) onGenerated?.();
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft emails">
      <div className="flex flex-col gap-4">
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {[...templates].sort(compareByCategory).map((t) => <option key={t.id} value={t.id}>{categoryLabel(t.name, t.category)}</option>)}
        </SelectField>
        {(() => {
          const chosen = templates.find((t) => t.id === templateId);
          if (!chosen) return null;
          const files = chosen.attachments ?? [];
          const links = chosen.links ?? [];
          return (
            <p className="rounded-lg bg-surface/60 p-2 text-xs text-muted">
              {files.length === 0 && links.length === 0
                ? 'This template has no attachments or links. You can add them in Emails, Templates.'
                : `Every draft will include: ${[...files.map((f) => `📎 ${f.name}`), ...links.map((l) => `🔗 ${l.label}`)].join(', ')}.`}
            </p>
          );
        })()}
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Personalise with AI
        </label>
        <label className="flex min-h-11 items-start gap-2">
          <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} disabled={otherCount === 0} className="mt-3 h-4 w-4 accent-violet-500" />
          <span className="py-2.5">
            Also write to decision-makers and other contacts
            <span className="block text-xs text-muted">
              {otherCount === 0 ? 'None found for the selected leads yet. Use Find decision maker first.' : `${otherCount} found. Each gets their own email, written for them.`}
            </span>
          </span>
        </label>

        <div className="rounded-lg bg-surface/60 p-3 text-sm" aria-live="polite">
          <p className="font-semibold">{targets.length === 0 ? 'No emails to write' : `Will write ${targets.length} ${targets.length === 1 ? 'email' : 'emails'}`}</p>
          {targets.length > 0 && (
            <ul className="mt-1 flex max-h-32 flex-col gap-0.5 overflow-y-auto text-xs text-muted">
              {targets.map((t) => (
                <li key={`${t.leadId}-${t.email}`} className="truncate">
                  {t.name ?? t.email}{t.title ? `, ${t.title}` : ''} at {t.businessName}
                </li>
              ))}
            </ul>
          )}
          {leadsWithoutAnyone.length > 0 && (
            <p className="mt-1 text-xs text-warning">
              {leadsWithoutAnyone.length} of {leads.length} selected {leadsWithoutAnyone.length === 1 ? 'lead has' : 'leads have'} nobody to write to and will be skipped.
            </p>
          )}
        </div>

        {busy && <p className="text-sm text-muted">{progress} / {targets.length} drafted…</p>}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleGenerate()} disabled={busy || !templateId || targets.length === 0} loading={busy}>
              {busy ? 'Generating…' : targets.length > 1 ? `Generate ${targets.length} drafts` : 'Generate drafts'}
            </Button>
          )}
          {summary && (
            <Button onClick={() => { onClose(); navigate('/emails?tab=release'); }}>
              Go to release queue
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
