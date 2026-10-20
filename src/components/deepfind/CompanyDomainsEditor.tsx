import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { blockDeepFindDomain } from '../../lib/deepFind';
import type { DeepFindDomain } from '../../lib/deepFindView';
import { Heading } from './Heading';

/**
 * The company domains as a small editable list. "Not their domain" removes a domain from the lead and blocks it, so
 * Deep find and the person lookups never save or search it again. Unconfirmed domains are marked "not confirmed".
 */
export function CompanyDomainsEditor({ leadId, domains, headingLevel = 3 }: { leadId: string; domains: DeepFindDomain[]; headingLevel?: number }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  const shown = domains.filter((d) => !removed.includes(d.domain));
  if (shown.length === 0 && !announcement) return null;

  async function block(domain: string) {
    setBusy(domain);
    setError(null);
    const err = await blockDeepFindDomain(leadId, domain);
    setBusy(null);
    if (err) { setError(err); return; }
    setRemoved((r) => [...r, domain]);
    setAnnouncement(`Blocked ${domain}`);
    // The pressed button is about to leave the page; keep focus on a stable status line.
    status.current?.focus();
  }

  return (
    <section className="flex flex-col gap-2 text-offwhite">
      <Heading level={headingLevel} className="font-heading text-sm font-bold">Company domains <span className="font-body text-[13px] font-normal">(found automatically, check before emailing)</span></Heading>
      {shown.length > 0 && <ul className="flex flex-wrap gap-1.5">
        {shown.map((d) => (
          <li key={d.domain} className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-line bg-surface/60 py-0.5 pl-2.5 pr-1 text-[13px]">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{d.domain}{d.needs_check ? ' (not confirmed)' : ''}</span>
            <button
              type="button"
              onClick={() => void block(d.domain)}
              disabled={busy !== null}
              aria-label={`Not their domain: ${d.domain}`}
              title="Not their domain"
              className="flex h-6 w-6 shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-line items-center justify-center rounded-full text-offwhite/80 hover:bg-surface hover:text-danger-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>}
      <p ref={status} tabIndex={-1} role="status" className="text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line">{announcement}</p>
      {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
    </section>
  );
}
