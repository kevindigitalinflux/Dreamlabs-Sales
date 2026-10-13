import { useState } from 'react';
import { Telescope } from 'lucide-react';
import { Button } from '../ui/Button';
import { CompanyDomainsEditor } from './CompanyDomainsEditor';
import type { Lead } from '../../types';
import { DeepFindModal } from './DeepFindModal';

/**
 * The lead card's Deep find entry point: the company domains found so far (each removable with "Not their domain")
 * and a "Deep find this lead" button that runs the same background engine for this one lead. New contacts arrive
 * through the Contacts card's own realtime subscription.
 */
export function DeepFindLeadControls({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const domains = (lead.email_domains ?? []).slice(0, 8).map((domain) => ({ domain, needs_check: false }));
  return (
    <div className="flex flex-col gap-2">
      <CompanyDomainsEditor key={domains.map((d) => d.domain).join(',')} leadId={lead.id} domains={domains} />
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Telescope className="h-4 w-4" aria-hidden /> Deep find this lead
        </Button>
      </div>
      <DeepFindModal open={open} leadIds={[lead.id]} onClose={() => setOpen(false)} />
    </div>
  );
}
