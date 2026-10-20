import { useState } from 'react';
import { unblockDeepFindDomain } from '../../lib/deepFind';
import type { Lead } from '../../types';

const small = 'min-h-6 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line disabled:opacity-50';

/** Domains marked "Not their domain" on this lead, each with a Restore button. Renders nothing when there are none. */
export function BlockedDomains({ lead }: { lead: Lead }) {
  const [restored, setRestored] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const list = (lead.blocked_domains ?? []).filter((d) => !restored.includes(d));
  if (list.length === 0 && !message) return null;

  async function restore(domain: string) {
    setBusy(domain);
    setError(null);
    const err = await unblockDeepFindDomain(lead.id, domain, false);
    setBusy(null);
    setConfirming(null);
    if (err) { setError(err); return; }
    setRestored((r) => [...r, domain]);
    setMessage(`Restored ${domain}. Deep find can use it again.`);
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-surface/60 p-3">
      <p className="text-xs font-semibold text-muted">Blocked domains</p>
      <ul className="flex flex-col gap-1.5">
        {list.map((d) => (
          <li key={d} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{d}</span>
            {confirming === d ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs">Let Deep find use {d} again?</span>
                <button type="button" onClick={() => void restore(d)} disabled={busy !== null} aria-label={`Confirm restore ${d}`} className={`${small} bg-card`}>Restore</button>
                <button type="button" onClick={() => setConfirming(null)} className={small}>Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(d)} disabled={busy !== null} aria-label={`Restore ${d}`} className={small}>Restore</button>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className="text-xs">{message}</p>
      {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
    </div>
  );
}
