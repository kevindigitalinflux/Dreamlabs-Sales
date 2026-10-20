import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { unblockDeepFindDomain } from '../../lib/deepFind';
import { ownBlockedDomains } from '../../lib/domainBlock';

/** Amber callout when the lead's own website or saved email domain was marked "not theirs" (Deep find then skips it). */
export function BlockedOwnDomainNotice({ leadId, lead }: { leadId: string; lead: { website?: string | null; email?: string | null; blocked_domains?: string[] | null } }) {
  const [restored, setRestored] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const own = ownBlockedDomains(lead).filter((o) => !restored.includes(o.domain));
  if (own.length === 0 && !message) return null;

  async function restore(domain: string) {
    setBusy(domain);
    setError(null);
    const err = await unblockDeepFindDomain(leadId, domain, false);
    setBusy(null);
    if (err) { setError(err); return; }
    setRestored((r) => [...r, domain]);
    setMessage(`Restored ${domain}. Run Deep find again to use it.`);
  }

  return (
    <div className="flex flex-col gap-2">
      {own.map((o) => (
        <div key={o.domain} className="flex items-start gap-2 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-3">
          <AlertTriangle size={18} aria-hidden className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-col items-start gap-2">
            <p>You marked <strong className="break-words [overflow-wrap:anywhere]">{o.domain}</strong> as not theirs, but it is this lead&apos;s {o.kind === 'website' ? 'website' : 'email domain'}. Deep find skips it.</p>
            <button type="button" onClick={() => void restore(o.domain)} disabled={busy !== null} aria-label={`Restore this domain: ${o.domain}`}
              className="inline-flex min-h-6 cursor-pointer items-center rounded-md border border-line bg-card px-2.5 py-1 text-xs font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line disabled:cursor-not-allowed disabled:opacity-50">
              {busy === o.domain ? 'Restoring...' : 'Restore this domain'}
            </button>
          </div>
        </div>
      ))}
      <p role="status" className="text-[13px]">{message}</p>
      {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
    </div>
  );
}
