import { useState } from 'react';
import { Telescope } from 'lucide-react';
import { Button } from '../ui/Button';
import { companyDomainsLine } from '../../lib/deepFindView';
import type { Lead } from '../../types';
import { DeepFindModal } from './DeepFindModal';

/**
 * The lead card's Deep find entry point: the company domains discovered so far (a muted line) and a
 * "Deep find this lead" button that runs the same background engine for this one lead. New contacts arrive through
 * the Contacts card's own realtime subscription.
 */
export function DeepFindLeadControls({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  const line = companyDomainsLine(lead.email_domains);
  return (
    <div className="flex flex-col gap-2">
      {line && <p className="text-xs text-muted">{line}</p>}
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Telescope className="h-4 w-4" aria-hidden /> Deep find this lead
        </Button>
      </div>
      <DeepFindModal open={open} leadIds={[lead.id]} onClose={() => setOpen(false)} />
    </div>
  );
}
