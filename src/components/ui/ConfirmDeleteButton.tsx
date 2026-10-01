import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';

interface ConfirmDeleteButtonProps {
  /** Does the deletion; resolves to an error message, or null on success. */
  onConfirm: () => Promise<string | null>;
  /** Visible label, e.g. "Delete" or "Remove". */
  label?: string;
  /** What it's asking about, e.g. "Delete this note?". */
  question?: string;
}

/**
 * A two-step delete: the first click only asks "sure?", the second does it, so a
 * stray tap can't remove something. Shows the error inline if the delete fails.
 */
export function ConfirmDeleteButton({ onConfirm, label = 'Delete', question = 'Delete this?' }: ConfirmDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    const err = await onConfirm();
    setBusy(false);
    if (err) { setError(err); return; }
    // On success the row normally disappears; reset in case the parent keeps it mounted.
    setConfirming(false);
    setError(null);
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => { setError(null); setConfirming(true); }}
        className="flex min-h-8 cursor-pointer items-center gap-1 text-xs font-semibold text-muted hover:text-danger"
      >
        <Trash2 className="h-3 w-3" aria-hidden /> {label}
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={question}>
      <span className="text-xs font-semibold">{question}</span>
      <Button variant="danger" onClick={() => void confirm()} disabled={busy} loading={busy}>
        {busy ? 'Deleting…' : `Yes, ${label.toLowerCase()}`}
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
      {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    </div>
  );
}
