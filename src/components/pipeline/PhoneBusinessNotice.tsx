import { useState } from 'react';
import { flagPhoneBusiness } from '../../lib/phoneBusiness';
import { parsePhone } from '../../../supabase/functions/_shared/phoneNumbers';
import type { Lead } from '../../types';
import type { LeadPatch } from '../../lib/leadUpdates';

/** Mark an individual subscriber explicitly; the flag is per canonical phone in the lead's existing JSON metadata. */
export function PhoneBusinessNotice({ value, lead, onSave }: { value: string; lead: Lead; onSave: (patch: LeadPatch) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const phone = parsePhone(value, lead.country);
  if (!phone) return null;
  async function flag(on: boolean) {
    setBusy(true); setError(null);
    try {
      setError(await onSave({ phone_meta: flagPhoneBusiness(value, lead.country, lead.phone_meta, on) }));
    } catch (error) {
      console.error('phone subscriber flag: save failed', error instanceof Error ? error.name : 'UnknownError');
      setError('Could not save this flag. Refresh and try again.');
    } finally { setBusy(false); }
  }
  return <div className="text-xs text-offwhite">
    <label className="flex min-h-11 cursor-pointer items-center gap-2">
      <input type="checkbox" checked={lead.phone_meta?.[phone.value]?.sole_trader === true} disabled={busy} onChange={e => void flag(e.target.checked)} />
      Sole trader or partnership
    </label>
    <p>Business numbers only. Check TPS/CTPS before cold calling in the UK. Sole traders and partnerships need stricter contact rules.</p>
    {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
  </div>;
}
