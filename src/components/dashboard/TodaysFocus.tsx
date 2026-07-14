import { CheckCircle2, Phone } from 'lucide-react';
import { daysOverdue, dueLabel, isDueToday, isOverdue } from '../../lib/utils';
import type { Lead } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { StageBadge } from '../pipeline/StageBadge';

interface TodaysFocusProps {
  leads: Lead[];
  onOpen: (lead: Lead) => void;
}

/** The day's follow-ups: overdue first (oldest debt first), then today's. */
export function TodaysFocus({ leads, onOpen }: TodaysFocusProps) {
  const due = leads
    .filter((l) => isDueToday(l.next_action_date) || isOverdue(l.next_action_date))
    .sort((a, b) => daysOverdue(b.next_action_date!, new Date()) - daysOverdue(a.next_action_date!, new Date()));

  if (due.length === 0) {
    return <EmptyState icon={CheckCircle2} title="All caught up" hint="No follow-ups due today. Set next-action dates on your leads to fill this list." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {due.map((lead) => {
        const overdue = isOverdue(lead.next_action_date);
        return (
          <li key={lead.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(lead)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(lead); }}
              className={`flex cursor-pointer flex-wrap items-center gap-3 rounded-lg border p-3 hover:bg-surface/60 ${overdue ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-card'}`}
            >
              <span className="font-heading text-sm font-bold">{lead.business_name}</span>
              <StageBadge stage={lead.stage} />
              <span className={`text-xs font-semibold ${overdue ? 'text-red-400' : 'text-cyan'}`}>
                {dueLabel(lead.next_action_date!)}
              </span>
              {lead.next_action_note && <span className="w-full text-sm text-muted sm:w-auto sm:flex-1">{lead.next_action_note}</span>}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()} className="ml-auto flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-cyan hover:bg-surface">
                  <Phone className="h-4 w-4" aria-hidden />
                  Call
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
