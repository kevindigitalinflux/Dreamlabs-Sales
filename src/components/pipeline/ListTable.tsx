import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortKey } from '../../lib/leadFilters';
import { dueLabel, formatCurrency, formatShortDate, initials, isOverdue, packageLabel } from '../../lib/utils';
import type { Lead, Profile } from '../../types';
import { StageBadge } from './StageBadge';
import { ReadinessBadge } from './ReadinessBadge';

interface ListTableProps {
  leads: Lead[];
  profiles: Profile[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  onOpen: (lead: Lead) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  /** Leads Deep find is queued for or working on: shown with a small chip. */
  deepFindRunning?: Set<string>;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'business_name', label: 'Company' },
  { key: 'owner_name', label: 'Owner' },
  { key: 'stage', label: 'Stage' },
  { key: 'readiness', label: 'Readiness' },
  { key: 'package_tier', label: 'Package' },
  { key: 'deal_value', label: 'Value' },
  { key: 'next_action_date', label: 'Next action' },
  { key: 'last_contacted_at', label: 'Last contacted' },
];

/** Sortable full-width lead table with sticky header; row click opens the panel. */
export function ListTable({ leads, profiles, sortKey, sortDir, onSort, onOpen, selected, onToggle, onToggleAll, deepFindRunning }: ListTableProps) {
  function assignee(lead: Lead): string {
    const p = profiles.find((x) => x.id === lead.assigned_to);
    return p ? initials(p.full_name ?? p.email) : '—';
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-line text-xs font-semibold text-muted">
            <th className="w-11 px-3">
              <input
                type="checkbox"
                checked={leads.length > 0 && selected.size === leads.length}
                onChange={onToggleAll}
                className="h-4 w-4 accent-violet-500"
                aria-label="Select all"
              />
            </th>
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
              <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={() => onToggle(lead.id)}
                  className="h-4 w-4 accent-violet-500"
                  aria-label={`Select ${lead.business_name}`}
                />
              </td>
              <td className="px-3 py-3 font-semibold">
                {lead.business_name}
                {deepFindRunning?.has(lead.id) && (
                  <span className="ml-2 rounded-full bg-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-cyan">Deep find running</span>
                )}
              </td>
              <td className="px-3 py-3 text-muted">{lead.owner_name ?? '—'}</td>
              <td className="px-3 py-3"><StageBadge stage={lead.stage} /></td>
              <td className="min-w-36 max-w-64 px-3 py-3"><ReadinessBadge readiness={lead.readiness} missing={lead.readiness_missing} /></td>
              <td className="px-3 py-3 text-muted">{packageLabel(lead.package_tier)}</td>
              <td className="px-3 py-3">{lead.deal_value !== null ? formatCurrency(lead.deal_value) : '—'}</td>
              <td className={`px-3 py-3 ${isOverdue(lead.next_action_date) ? 'font-semibold text-danger' : 'text-muted'}`}>
                {lead.next_action_date ? dueLabel(lead.next_action_date) : '—'}
              </td>
              <td className="px-3 py-3 text-muted">{lead.last_contacted_at ? formatShortDate(lead.last_contacted_at) : 'Never'}</td>
              <td className="px-3 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-purple text-[10px] font-bold text-on-accent">{assignee(lead)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
