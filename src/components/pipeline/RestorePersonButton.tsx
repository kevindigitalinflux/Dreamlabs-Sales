import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { restoreDismissedContact } from '../../lib/restoreDismissed';
import { Button } from '../ui/Button';

/**
 * "Restore <name>": clears dismissed_at through the user's session, only while the contact is still dismissed.
 * Shows its own error. With `showStatus` it also keeps a role=status line ("Restored <name>") after success;
 * callers whose row disappears announce the result themselves through `onRestored`.
 */
export function RestorePersonButton({ contactId, name, onRestored, showStatus = false }: { contactId: string; name: string; onRestored?: (message: string) => void; showStatus?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function restore() {
    setBusy(true); setError(null);
    const res = await restoreDismissedContact(supabase, contactId, name);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    setDone(res.message);
    if (res.message) onRestored?.(res.message);
  }

  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-1">
      {!done && <Button variant="secondary" className="min-h-11 text-[13px]" loading={busy} onClick={() => void restore()} aria-label={`Restore ${name}`}>
        {!busy && <RotateCcw size={14} aria-hidden />}Restore {name}
      </Button>}
      {showStatus && <span role="status" className="text-[13px] font-semibold">{done}</span>}
      {error && <span role="alert" className="text-[13px] font-semibold text-danger-strong">{error}</span>}
    </span>
  );
}
