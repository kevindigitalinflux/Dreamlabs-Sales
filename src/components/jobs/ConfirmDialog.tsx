import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What is about to happen, in plain words. */
  body: string;
  /** An extra warning sentence (shown separately), or null. */
  warning?: string | null;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** In-page confirmation (never window.confirm): Cancel and a danger button; the danger button shows a spinner while it works. */
export function ConfirmDialog({ open, title, body, warning = null, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{body}</p>
        {warning && <p className="text-sm text-muted">{warning}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
