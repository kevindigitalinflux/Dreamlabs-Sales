import { isOverdue, STAGES } from './utils';
import type { Lead, Stage } from '../types';

export interface LeadFilters {
  search: string;
  stages: Stage[];
  assignees: string[];
  overdueOnly: boolean;
}

/** Applies search + stage + assignee + overdue filters. Empty arrays mean "all". */
export function filterLeads(leads: Lead[], filters: LeadFilters, today: Date = new Date()): Lead[] {
  const q = filters.search.trim().toLowerCase();
  return leads.filter((lead) => {
    if (q) {
      const haystack = `${lead.business_name} ${lead.owner_name ?? ''} ${lead.email ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filters.stages.length > 0 && !filters.stages.includes(lead.stage)) return false;
    if (filters.assignees.length > 0 && (!lead.assigned_to || !filters.assignees.includes(lead.assigned_to))) return false;
    if (filters.overdueOnly && !isOverdue(lead.next_action_date, today)) return false;
    return true;
  });
}

export type SortKey =
  | 'business_name' | 'owner_name' | 'stage' | 'package_tier'
  | 'deal_value' | 'next_action_date' | 'last_contacted_at';

const STAGE_ORDER = new Map(STAGES.map((s, i) => [s.value, i]));

function sortValue(lead: Lead, key: SortKey): string | number | null {
  if (key === 'stage') return STAGE_ORDER.get(lead.stage) ?? null;
  return lead[key];
}

/** Returns a new sorted array. Nulls sort last in both directions; stage uses pipeline order. */
export function sortLeads(leads: Lead[], key: SortKey, dir: 'asc' | 'desc'): Lead[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...leads].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
    return String(va).localeCompare(String(vb)) * sign;
  });
}
