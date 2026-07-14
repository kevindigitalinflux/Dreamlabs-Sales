import { formatShortDate } from '../../lib/utils';
import type { Lead } from '../../types';
import { StageBadge } from '../pipeline/StageBadge';

/** Last 5 touched leads — quick re-entry into live conversations. */
export function RecentlyActive({ leads, onOpen }: { leads: Lead[]; onOpen: (lead: Lead) => void }) {
  const recent = [...leads]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);
  if (recent.length === 0) return <p className="text-sm text-muted">Nothing here yet — activity shows up as you work leads.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {recent.map((lead) => (
        <li key={lead.id}>
          <button type="button" onClick={() => onOpen(lead)} className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 text-left hover:bg-surface/60">
            <span className="flex-1 truncate text-sm font-semibold">{lead.business_name}</span>
            <StageBadge stage={lead.stage} />
            <span className="text-xs text-muted">{formatShortDate(lead.updated_at)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
