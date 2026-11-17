import { CalendarClock, Mail, MapPin, NotebookPen, Phone, PhoneCall, Star, Telescope, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { buttonClasses } from '../../lib/ui/buttonClasses';
import { dueLabel, formatCurrency, formatShortDate, initials, isOverdue, packageLabel } from '../../lib/utils';
import type { Lead } from '../../types';
import { Button } from '../ui/Button';
import { StageBadge } from './StageBadge';
import { ReadinessBadge } from './ReadinessBadge';

interface Props {
  lead: Lead;
  assigneeName: string | null;
  onTogglePriority: () => void;
  onEmail: () => void;
  onDeepFind: () => void;
  onNote: () => void;
}

function Tile({ icon: Icon, label, value, tone = 'plain' }: { icon: LucideIcon; label: string; value: string; tone?: 'plain' | 'attention' }) {
  return (
    <div className={`flex items-center gap-3 rounded-nested px-3 py-2.5 ${tone === 'attention' ? 'bg-attention-soft' : 'bg-surface'}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-nested ${tone === 'attention' ? 'bg-attention/15 text-attention' : 'bg-violet/15 text-link'}`}><Icon className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0">
        <b className={`block truncate font-heading text-[15px] font-bold ${tone === 'attention' ? 'text-attention' : ''}`}>{value}</b>
        <span className="text-[13px] text-muted">{label}</span>
      </span>
    </div>
  );
}

/** Top of the full lead record: who and how valuable, the main actions, and four at-a-glance facts. */
export function LeadDetailHeader({ lead, assigneeName, onTogglePriority, onEmail, onDeepFind, onNote }: Props) {
  const overdue = isOverdue(lead.next_action_date);
  const place = [lead.city, lead.postcode].filter(Boolean).join(', ');
  const subtitle = [lead.owner_name, lead.vertical].filter(Boolean).join(', ');
  return (
    <header className="overflow-hidden rounded-surface border border-line bg-raised shadow-raised">
      <div className="h-1.5 bg-linear-to-r from-violet via-purple to-magenta" aria-hidden />
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-surface bg-linear-to-br from-violet to-purple font-heading text-xl font-bold text-on-accent shadow-glow">{initials(lead.business_name)}</span>
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex items-center gap-2">
              <h1 className="min-w-0 break-words font-heading text-[28px] font-bold leading-tight">{lead.business_name}</h1>
              <button type="button" onClick={onTogglePriority} aria-pressed={lead.is_priority} aria-label={lead.is_priority ? 'Unmark as priority' : 'Mark as priority'}
                className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control focus-visible:outline-2 focus-visible:outline-focus ${lead.is_priority ? 'text-warning' : 'text-muted hover:text-warning'}`}>
                <Star className="h-5 w-5" aria-hidden fill={lead.is_priority ? 'currentColor' : 'none'} />
              </button>
            </div>
            {subtitle && <p className="text-muted">{subtitle}</p>}
            {place && <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden />{place}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StageBadge stage={lead.stage} />
              <ReadinessBadge compact readiness={lead.readiness} missing={lead.readiness_missing} />
              {assigneeName && <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[13px] font-medium"><span aria-hidden className="flex h-5 w-5 items-center justify-center rounded-full bg-purple text-[10px] font-bold text-on-accent">{initials(assigneeName)}</span>{assigneeName}</span>}
            </div>
          </div>
          <div className="text-right">
            {lead.deal_value !== null && <p className="font-heading text-[26px] font-bold leading-none text-link">{formatCurrency(lead.deal_value)}</p>}
            {lead.package_tier && <p className="mt-1 text-sm text-muted">{packageLabel(lead.package_tier)}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phone ? <a href={`tel:${lead.phone}`} className={buttonClasses('primary', 'md')}><Phone className="h-4 w-4" aria-hidden />Call</a>
            : <Button disabled title="No phone number saved"><Phone className="h-4 w-4" aria-hidden />Call</Button>}
          <Button variant="secondary" onClick={onEmail}><Mail className="h-4 w-4" aria-hidden />Email</Button>
          <Button variant="secondary" onClick={onDeepFind}><Telescope className="h-4 w-4" aria-hidden />Deep find</Button>
          <Button variant="secondary" onClick={onNote}><NotebookPen className="h-4 w-4" aria-hidden />Add note</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile icon={CalendarClock} label="Next action" value={lead.next_action_date ? dueLabel(lead.next_action_date) : 'Not set'} tone={overdue ? 'attention' : 'plain'} />
          <Tile icon={PhoneCall} label="Last contacted" value={lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'} />
          <Tile icon={Phone} label="Calls made" value={String(lead.call_count)} />
          <Tile icon={Wallet} label="Deal value" value={lead.deal_value !== null ? formatCurrency(lead.deal_value) : 'Not set'} />
        </div>
      </div>
    </header>
  );
}
