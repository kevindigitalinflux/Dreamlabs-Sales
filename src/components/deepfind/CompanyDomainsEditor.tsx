import { useEffect, useRef, useState } from 'react';
import { Ban } from 'lucide-react';
import { blockDeepFindDomain, unblockDeepFindDomain, wasInEmailDomains } from '../../lib/deepFind';
import type { DeepFindDomain } from '../../lib/deepFindView';
import { Heading } from './Heading';

const btn = 'inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-md border px-2 py-0.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The company domains as a small editable list. "Not their domain" asks to confirm in place, then removes the domain
 * from the lead and blocks it, so Deep find and the person lookups never save or search it again. A status line with
 * Undo follows. Unconfirmed domains are marked "not confirmed".
 */
export function CompanyDomainsEditor({ leadId, domains, headingLevel = 3 }: { leadId: string; domains: DeepFindDomain[]; headingLevel?: number }) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [undo, setUndo] = useState<{ domain: string; restoreToEmail: boolean } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const triggers = useRef<Record<string, HTMLButtonElement | null>>({});
  const shown = domains.filter((d) => !removed.includes(d.domain));

  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);
  useEffect(() => { if (undo) undoRef.current?.focus(); }, [undo]);

  if (shown.length === 0 && !announcement && !undo) return null;

  function cancel(domain: string) {
    setConfirming(null);
    setTimeout(() => triggers.current[domain]?.focus(), 0);
  }

  async function block(domain: string) {
    setBusy(domain);
    setError(null);
    const restoreToEmail = (await wasInEmailDomains(leadId, domain)) === true;
    const err = await blockDeepFindDomain(leadId, domain);
    setBusy(null);
    setConfirming(null);
    if (err) { setError(err); setTimeout(() => triggers.current[domain]?.focus(), 0); return; }
    setRemoved((r) => [...r, domain]);
    setAnnouncement(`Blocked ${domain}.`);
    setUndo({ domain, restoreToEmail });
  }

  async function undoBlock() {
    if (!undo) return;
    setBusy(undo.domain);
    setError(null);
    const err = await unblockDeepFindDomain(leadId, undo.domain, undo.restoreToEmail);
    setBusy(null);
    if (err) { setError(err); return; }
    setRemoved((r) => r.filter((d) => d !== undo.domain));
    setAnnouncement(`Restored ${undo.domain}.`);
    setUndo(null);
    status.current?.focus();
  }

  return (
    <section className="flex flex-col gap-2 text-offwhite">
      <Heading level={headingLevel} className="font-heading text-sm font-bold">Company domains <span className="font-body text-[13px] font-normal">(found automatically, check before emailing)</span></Heading>
      {shown.length > 0 && <ul className="flex flex-col gap-1.5">
        {shown.map((d) => (
          <li key={d.domain} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-surface/60 px-2.5 py-1.5 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{d.domain}{d.needs_check ? ' (not confirmed)' : ''}</span>
              {confirming !== d.domain && (
                <button type="button" ref={(el) => { triggers.current[d.domain] = el; }} onClick={() => setConfirming(d.domain)} disabled={busy !== null}
                  aria-label={`Not their domain: ${d.domain}`} className={`${btn} border-line text-offwhite hover:bg-surface`}>
                  <Ban className="mr-1 h-3.5 w-3.5" aria-hidden />Not their domain
                </button>
              )}
            </div>
            {confirming === d.domain && (
              <div role="group" aria-label={`Confirm blocking ${d.domain}`} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(d.domain); } }} className="flex flex-col gap-1.5 border-t border-line pt-1.5">
                <p>Block <strong>{d.domain}</strong> for this lead? Deep find will never use it again.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void block(d.domain)} disabled={busy !== null} aria-label={`Block ${d.domain}`} className={`${btn} border-red-500/50 bg-red-500/15 text-danger-strong hover:bg-red-500/25`}>{busy === d.domain ? 'Blocking...' : 'Block'}</button>
                  <button type="button" ref={cancelRef} onClick={() => cancel(d.domain)} disabled={busy !== null} className={`${btn} border-line text-offwhite hover:bg-surface`}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>}
      <div className="flex flex-wrap items-center gap-2">
        <p ref={status} tabIndex={-1} role="status" className="text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-line">{announcement}</p>
        {undo && <button type="button" ref={undoRef} onClick={() => void undoBlock()} disabled={busy !== null} aria-label={`Undo blocking ${undo.domain}`} className={`${btn} border-line text-offwhite hover:bg-surface`}>Undo</button>}
      </div>
      {error && <p role="alert" className="text-xs text-danger-strong">{error}</p>}
    </section>
  );
}
