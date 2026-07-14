import { CalendarClock, Kanban, MailCheck, PhoneCall } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isDueToday, isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';

interface StatsBarProps {
  leads: Lead[];
  leadsLoading: boolean;
  draftCount: number | null;
  callsThisWeek: number | null;
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | null }) {
  return (
    <Card className="flex flex-1 items-center gap-3">
      <Icon className="h-6 w-6 shrink-0 text-cyan" aria-hidden />
      <div>
        {value === null ? <Skeleton className="h-7 w-10" /> : <p className="font-heading text-[22px] font-bold">{value}</p>}
        <p className="text-xs font-semibold text-muted">{label}</p>
      </div>
    </Card>
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
