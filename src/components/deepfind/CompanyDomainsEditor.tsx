import { useState } from 'react';
import { X } from 'lucide-react';
import { blockDeepFindDomain } from '../../lib/deepFind';
import type { DeepFindDomain } from '../../lib/deepFindView';

/**
 * The company domains as a small editable list. "Not their domain" removes a domain from the lead and blocks it, so
 * Deep find and the person lookups never save or search it again. Unconfirmed domains are marked "not confirmed".
 */
export function CompanyDomainsEditor({ leadId, domains }: { leadId: string; domains: DeepFindDomain[] }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = domains.filter((d) => !removed.includes(d.domain));
  if (shown.length === 0) return null;

  async function block(domain: string) {
    setBusy(domain);
    setError(null);
    const err = await blockDeepFindDomain(leadId, domain);
    setBusy(null);
    if (err) setError(err); else setRemoved((r) => [...r, domain]);
  }

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted">Company domains (found automatically, check before emailing):</p>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((d) => (
          <li key={d.domain} className="flex items-center gap-1 rounded-full bg-surface/60 py-0.5 pl-2.5 pr-1 text-xs">
            <span>{d.domain}{d.needs_check ? ' (not confirmed)' : ''}</span>
            <button
              type="button"
              onClick={() => void block(d.domain)}
              disabled={busy !== null}
              aria-label={`Not their domain: ${d.domain}`}
              title="Not their domain"
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-surface hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}
