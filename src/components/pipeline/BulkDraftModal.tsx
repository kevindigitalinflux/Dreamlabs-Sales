import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { readableInvokeError } from '../../lib/invokeError';
import { supabase } from '../../lib/supabase';
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

interface RecipientTarget { lead: Lead; email: string; recipientName: string | null; candidateId: string | null }

/**
 * Generates one email draft per recipient from a single shared template,
 * reusing the exact generate-email + email_logs insert path EmailComposer's
 * own "Save as draft" already uses. Leads with no email address of their
 * own are skipped up front unless the "include decision-maker contacts"
 * toggle finds them a recipient another way.
 */
export function BulkDraftModal({ open, leads, onClose, onGenerated }: BulkDraftModalProps) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { templates } = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [includeDecisionMakers, setIncludeDecisionMakers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalTargets, setTotalTargets] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  // The modal stays mounted for the page's lifetime (Modal just returns null
  // while closed), so `summary` would survive a close and permanently hide the
  // Generate button on reopen. Reset it whenever the modal opens — same pattern
  // EnrichmentReview uses for the same reason.
  useEffect(() => {
    if (open) {
      setSummary(null);
      setProgress(0);
      setIncludeDecisionMakers(false);
    }
  }, [open]);

  const leadsWithEmail = leads.filter((l) => l.email);
  const withoutEmailCount = leads.length - leadsWithEmail.length;

  async function buildTargets(): Promise<RecipientTarget[]> {
    const targets: RecipientTarget[] = [];
    for (const lead of leadsWithEmail) targets.push({ lead, email: lead.email!, recipientName: null, candidateId: null });
    if (!includeDecisionMakers) return targets;
    const leadIds = leads.map((l) => l.id);
    const { data } = await supabase.from('decision_maker_candidates').select('*').in('lead_id', leadIds).not('email', 'is', null);
    for (const dm of (data as DecisionMakerCandidate[] | null) ?? []) {
      const lead = leads.find((l) => l.id === dm.lead_id);
      if (!lead) continue;
      const name = `${dm.first_name ?? ''} ${dm.last_name ?? ''}`.trim() || null;
      targets.push({ lead, email: dm.email!, recipientName: name, candidateId: dm.id });
    }
    return targets;
  }

  async function handleGenerate() {
    if (!templateId || !currentOrg || !session) return;
    setBusy(true);
    setProgress(0);
    setSummary(null);
    const targets = await buildTargets();
    setTotalTargets(targets.length);
    let drafted = 0;
    let firstFailReason: string | null = null;
    for (const target of targets) {
      const { data, error: invokeErr } = await supabase.functions.invoke('generate-email', {
        body: { lead_id: target.lead.id, template_id: templateId, use_ai: useAi, recipient_name: target.recipientName ?? undefined },
      });
      if (invokeErr) {
        if (!firstFailReason) firstFailReason = await readableInvokeError(invokeErr);
        setProgress((p) => p + 1);
        continue;
      }
      const result = data as { subject?: string; body?: string; error?: string } | null;
      if (result && !result.error && result.subject && result.body) {
        const { error: insertErr } = await supabase.from('email_logs').insert({
          lead_id: target.lead.id, to_email: target.email, subject: result.subject, body: result.body,
          status: 'draft', sent_by: session.user.id, org_id: currentOrg.id,
          decision_maker_candidate_id: target.candidateId,
        });
        if (!insertErr) drafted++;
        else if (!firstFailReason) firstFailReason = insertErr.message;
      } else if (!firstFailReason) {
        firstFailReason = result?.error ?? 'Draft generation failed';
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    const skippedFailed = targets.length - drafted;
    const parts = [`Drafted ${drafted} emails`];
    if (withoutEmailCount > 0 && !includeDecisionMakers) parts.push(`${withoutEmailCount} leads skipped (no email address)`);
    if (skippedFailed > 0) parts.push(`${skippedFailed} failed to draft${firstFailReason ? ` (${firstFailReason})` : ''}`);
    setSummary(parts.join(' — '));
    if (drafted > 0) onGenerated?.();
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft emails">
      <div className="flex flex-col gap-4">
        {withoutEmailCount > 0 && (
          <p className="text-sm text-warning">{withoutEmailCount} of {leads.length} selected leads have no email address of their own{includeDecisionMakers ? '' : ' and will be skipped'}.</p>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Personalise with AI
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={includeDecisionMakers} onChange={(e) => setIncludeDecisionMakers(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Also include decision-maker contacts
        </label>
        {busy && <p className="text-sm text-muted">{progress} / {totalTargets} drafted…</p>}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleGenerate()} disabled={busy || !templateId || leads.length === 0} loading={busy}>
              {busy ? 'Generating…' : 'Generate drafts'}
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
