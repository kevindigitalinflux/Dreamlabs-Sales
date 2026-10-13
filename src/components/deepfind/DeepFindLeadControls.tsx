import { useState } from 'react';
import { Link } from 'react-router';
import { Telescope } from 'lucide-react';
import { Button } from '../ui/Button';
import { CompanyDomainsEditor } from './CompanyDomainsEditor';
import { useLeadDeepFind } from '../../hooks/useLeadDeepFind';
import type { Lead } from '../../types';
import { DeepFindModal } from './DeepFindModal';

/**
 * The lead card's Deep find entry point: the company domains found so far (each removable with "Not their domain"),
 * a "Deep find running" chip while this lead is queued or being searched, a "Deep find results" link once a run has
 * looked at it, and a "Deep find this lead" button that runs the same background engine for this one lead. New
 * contacts arrive through the Contacts card's own realtime subscription.
 */
export function DeepFindLeadControls({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const latest = useLeadDeepFind(lead.id);
  const working = latest?.status === 'queued' || latest?.status === 'running';
  const domains = (lead.email_domains ?? []).slice(0, 8).map((domain) => ({ domain, needs_check: false }));
  return (
    <div className="flex flex-col gap-2">
      <CompanyDomainsEditor key={domains.map((d) => d.domain).join(',')} leadId={lead.id} domains={domains} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)} disabled={working}>
          <Telescope className="h-4 w-4" aria-hidden /> Deep find this lead
        </Button>
        {working && <span role="status" className="rounded-full bg-cyan/15 px-2 py-0.5 text-xs font-semibold text-cyan">Deep find running</span>}
        {latest && (
          <Link to={`/pipeline/deep-find/${latest.run_id}`} className="text-xs text-muted underline hover:text-offwhite">
            Deep find results
          </Link>
        )}
      </div>
      <DeepFindModal open={open} leadIds={[lead.id]} onClose={() => setOpen(false)} />
    </div>
  );
}
