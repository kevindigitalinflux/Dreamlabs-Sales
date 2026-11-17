import { useNavigate } from 'react-router';
import { Mail, Phone, Star, Telescope, X } from 'lucide-react';
import { buttonClasses } from '../../lib/ui/buttonClasses';
import { formatCurrency, packageLabel } from '../../lib/utils';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { StageBadge } from './StageBadge';
import { ReadinessBadge } from './ReadinessBadge';

interface Props {
  lead: Lead;
  onClose: () => void;
  onUpdate: (id: string, patch: LeadPatch) => Promise<string | null>;
  onEmail: () => void;
  onDeepFind: () => void;
}

/** Top of the lead record: who it is, stage and value at a glance, and the three things you do most (call, email, Deep find). */
export function LeadPanelHeader({ lead, onClose, onUpdate, onEmail, onDeepFind }: Props) {
  const navigate = useNavigate();
  const subtitle = [lead.owner_name, lead.vertical].filter(Boolean).join(', ');
  return (
    <div className="shrink-0 px-6 pb-4 pt-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-[22px] font-bold leading-tight">{lead.business_name}</h2>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => void onUpdate(lead.id, { is_priority: !lead.is_priority })}
            aria-pressed={lead.is_priority}
            aria-label={lead.is_priority ? 'Unmark as priority' : 'Mark as priority'}
            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-focus md:h-10 md:w-10 ${lead.is_priority ? 'text-warning' : 'text-muted hover:text-warning'}`}
          >
            <Star className="h-4 w-4" aria-hidden fill={lead.is_priority ? 'currentColor' : 'none'} />
          </button>
          <IconButton label="Close panel" icon={X} onClick={onClose} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StageBadge stage={lead.stage} />
        <ReadinessBadge compact readiness={lead.readiness} missing={lead.readiness_missing} />
        {lead.deal_value !== null && <span className="font-heading text-base font-bold">{formatCurrency(lead.deal_value)}</span>}
        {lead.package_tier && <span className="text-sm text-muted">{packageLabel(lead.package_tier)}</span>}
      </div>
      <div className="mt-4 flex gap-2">
        {lead.phone ? (
          <a href={`tel:${lead.phone}`} className={`${buttonClasses('primary', 'md')} flex-1`}><Phone className="h-4 w-4" aria-hidden />Call</a>
        ) : (
          <Button className="flex-1" disabled title="No phone number saved"><Phone className="h-4 w-4" aria-hidden />Call</Button>
        )}
        <Button variant="secondary" className="flex-1" onClick={onEmail}><Mail className="h-4 w-4" aria-hidden />Email</Button>
        <Button variant="secondary" className="flex-1" onClick={onDeepFind}><Telescope className="h-4 w-4" aria-hidden />Deep find</Button>
      </div>
      <button type="button" onClick={() => navigate(`/pipeline/leads/${lead.id}`)} className="mt-3 cursor-pointer text-sm font-semibold text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-focus">
        Open full record
      </button>
    </div>
  );
}
