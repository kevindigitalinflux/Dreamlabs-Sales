import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useOrg } from '../../hooks/useOrg';
import { useTemplates } from '../../hooks/useTemplates';
import { supabase } from '../../lib/supabase';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { SelectField } from '../ui/Input';

interface BulkDraftModalProps {
  open: boolean;
  leads: Lead[];
  onClose: () => void;
}

/**
 * Generates one email draft per selected lead from a single shared
 * template, reusing the exact generate-email + email_logs insert path
 * EmailComposer's own "Save as draft" already uses. Leads with no email
 * address are skipped up front, not failed mid-loop.
 */
export function BulkDraftModal({ open, leads, onClose }: BulkDraftModalProps) {
  const { session } = useAuth();
  const { currentOrg } = useOrg();
  const { templates } = useTemplates();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState('');
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  const withEmail = leads.filter((l) => l.email);
  const withoutEmailCount = leads.length - withEmail.length;

  async function handleGenerate() {
    if (!templateId || !currentOrg || !session) return;
    setBusy(true);
    setProgress(0);
    setSummary(null);
    let drafted = 0;
    for (const lead of withEmail) {
      const { data } = await supabase.functions.invoke('generate-email', {
        body: { lead_id: lead.id, template_id: templateId, use_ai: useAi },
      });
      const result = data as { subject?: string; body?: string; error?: string } | null;
      if (result && !result.error && result.subject && result.body) {
        const { error: insertErr } = await supabase.from('email_logs').insert({
          lead_id: lead.id, to_email: lead.email, subject: result.subject, body: result.body,
          status: 'draft', sent_by: session.user.id, org_id: currentOrg.id,
        });
        if (!insertErr) drafted++;
      }
      setProgress((p) => p + 1);
    }
    setBusy(false);
    const skippedFailed = withEmail.length - drafted;
    const parts = [`Drafted ${drafted} emails`];
    if (withoutEmailCount > 0) parts.push(`${withoutEmailCount} skipped (no email address)`);
    if (skippedFailed > 0) parts.push(`${skippedFailed} failed to draft`);
    setSummary(parts.join(' — '));
  }

  return (
    <Modal open={open} onClose={onClose} title="Draft emails">
      <div className="flex flex-col gap-4">
        {withoutEmailCount > 0 && (
          <p className="text-sm text-warning">{withoutEmailCount} of {leads.length} selected leads have no email address and will be skipped.</p>
        )}
        <SelectField label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          <option value="">Choose…</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} className="h-4 w-4 accent-violet-500" />
          Personalise with AI
        </label>
        {busy && <p className="text-sm text-muted">{progress} / {withEmail.length} drafted…</p>}
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void handleGenerate()} disabled={busy || !templateId || withEmail.length === 0}>
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
