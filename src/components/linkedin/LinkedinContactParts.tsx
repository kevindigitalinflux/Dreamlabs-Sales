import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { ContactWithLead } from '../../hooks/useLinkedinOutreach';
import { Button } from '../ui/Button';

/** Under a contact's name: their job title (to judge if LinkedIn is worth it) and which lead they came from. */
export function LeadSource({ contact }: { contact: ContactWithLead }) {
  const { lead, lead_id: leadId, candidate } = contact;
  const source = lead ? `From lead: ${lead.business_name}` : leadId ? 'From a lead you can’t view' : 'Added manually (no lead)';
  return (
    <span className="block">
      <span className="block break-words text-xs text-muted">{candidate?.title ? `Position: ${candidate.title}` : 'Position: not known'}</span>
      <span className="block break-words text-xs text-muted">{source}</span>
    </span>
  );
}

/** Trash button that asks "Delete?" before acting, since removing a contact also removes its drafts. */
export function DeleteContactButton({ onDelete, onError }: { onDelete: () => Promise<string | null>; onError: (message: string | null) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    onError(await onDelete());
    setBusy(false);
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)} aria-label="Delete contact" title="Delete this contact">
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Button variant="secondary" onClick={() => void run()} disabled={busy} loading={busy}>Delete?</Button>
      <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Keep</Button>
    </span>
  );
}
