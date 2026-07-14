import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortKey } from '../../lib/leadFilters';
import { dueLabel, formatCurrency, formatShortDate, initials, isOverdue, packageLabel } from '../../lib/utils';
import type { Lead, Profile } from '../../types';
import { StageBadge } from './StageBadge';

interface ListTableProps {
  leads: Lead[];
  profiles: Profile[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onOpen: (lead: Lead) => void;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'business_name', label: 'Company' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'stage', label: 'Stage' },
  { key: 'package_tier', label: 'Package' },
  { key: 'deal_value', label: 'Value' },
  { key: 'next_action_date', label: 'Next action' },
  { key: 'last_contacted_at', label: 'Last contacted' },
];

/** Sortable full-width lead table with sticky header; row click opens the panel. */
export function ListTable({ leads, profiles, sortKey, sortDir, onSort, onOpen }: ListTableProps) {
  function assignee(lead: Lead): string {
    const p = profiles.find((x) => x.id === lead.assigned_to);
    return p ? initials(p.full_name ?? p.email) : '—';
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-navy">
          <tr className="border-b border-line text-xs font-semibold text-muted">
            {COLUMNS.map((col) => (
              <th key={col.key} aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => onSort(col.key)} className="flex min-h-11 w-full cursor-pointer items-center gap-1 px-3 hover:text-offwhite">
                  {col.label}
                  {sortKey === col.key && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />)}
                </button>
              </th>
            ))}
            <th className="px-3">Assigned</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} onClick={() => onOpen(lead)} className="cursor-pointer border-b border-line last:border-0 hover:bg-surface/50">
              <td className="px-3 py-3 font-semibold">{lead.business_name}</td>
              <td className="px-3 py-3 text-muted">{lead.owner_name ?? '—'}</td>
              <td className="px-3 py-3"><StageBadge stage={lead.stage} /></td>
              <td className="px-3 py-3 text-muted">{packageLabel(lead.package_tier)}</td>
              <td className="px-3 py-3">{lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—'}</td>
              <td className={`px-3 py-3 ${isOverdue(lead.next_action_date) ? 'font-semibold text-red-400' : 'text-muted'}`}>
                {lead.next_action_date ? dueLabel(lead.next_action_date) : '—'}
              </td>
              <td className="px-3 py-3 text-muted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</td>
              <td className="px-3 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple text-[10px] font-bold">{assignee(lead)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
