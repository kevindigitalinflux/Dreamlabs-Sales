import { CalendarClock, Kanban, MailCheck, PhoneCall } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isDueToday, isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';
import { Skeleton } from '../ui/Skeleton';

interface StatsBarProps {
  leads: Lead[];
  leadsLoading: boolean;
  draftCount: number | null;
  callsThisWeek: number | null;
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  return (
    <div className="flex flex-1 items-start justify-between gap-3 rounded-surface border border-line bg-raised px-4 py-3 shadow-raised">
      <div>
        {value === null ? <Skeleton className="h-8 w-12" /> : <b className="block font-heading text-2xl font-bold">{value}</b>}
        <span className="text-[13px] text-muted">{label}</span>
      </div>
      <Icon className="h-5 w-5 shrink-0 text-link" aria-hidden />
    </div>
  );
}

/** Four headline numbers (SPEC.md §8.2). */
export function StatsBar({ leads, leadsLoading, draftCount, callsThisWeek }: StatsBarProps) {
  const due = leads.filter((l) => isDueToday(l.next_action_date) || isOverdue(l.next_action_date)).length;
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Stat icon={Kanban} label="Leads in pipeline" value={leadsLoading ? null : leads.length} />
      <Stat icon={CalendarClock} label="Follow-ups due" value={leadsLoading ? null : due} />
      <Stat icon={MailCheck} label="Emails to review" value={draftCount} />
      <Stat icon={PhoneCall} label="Calls this week" value={callsThisWeek} />
    </div>
  );
}
