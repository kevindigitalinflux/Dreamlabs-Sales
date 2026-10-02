import { useEffect, useState } from 'react';
import type { IdealCustomerProfile, Lead } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { IcpSelect } from '../emails/IcpSelect';

interface BulkProfileModalProps {
  open: boolean;
  leads: Lead[];
  icps: IdealCustomerProfile[];
  onClose: () => void;
  /** Sets (or clears, with null) one lead's customer profile; resolves to an error message or null. */
  onAssign: (leadId: string, icpId: string | null) => Promise<string | null>;
  onDone?: () => void;
}

/**
 * Tags every selected lead with one customer profile in a single step, so existing leads can be
 * classified without opening each one. Choosing "None" clears the profile instead.
 */
export function BulkProfileModal({ open, leads, icps, onClose, onAssign, onDone }: BulkProfileModalProps) {
  const [icpId, setIcpId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setIcpId(null); setSummary(null); }
  }, [open]);

  async function apply() {
    setBusy(true);
    let failed = 0;
    for (const lead of leads) {
      const err = await onAssign(lead.id, icpId);
      if (err) failed++;
    }
    setBusy(false);
    const done = leads.length - failed;
    setSummary(failed === 0 ? `Updated ${done} ${done === 1 ? 'lead' : 'leads'}` : `Updated ${done}, ${failed} failed`);
    if (done > 0) onDone?.();
  }

  const chosenName = icps.find((p) => p.id === icpId)?.name;

  return (
    <Modal open={open} onClose={onClose} title="Set customer profile">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Tag the {leads.length} selected {leads.length === 1 ? 'lead' : 'leads'} with a customer profile. Emails to them then use
          that profile's pain points and context. Choose None to clear it.
        </p>
        <IcpSelect icps={icps} value={icpId} onChange={setIcpId} label="Customer profile" />
        {summary && <p role="status" className="text-sm text-success">{summary}</p>}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>{summary ? 'Close' : 'Cancel'}</Button>
          {!summary && (
            <Button onClick={() => void apply()} disabled={busy || leads.length === 0} loading={busy}>
              {busy ? 'Applying…' : icpId ? `Set to ${chosenName ?? 'profile'}` : 'Clear profile'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
