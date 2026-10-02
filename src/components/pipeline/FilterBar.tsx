import { AlertCircle, Search } from 'lucide-react';
import { STAGES } from '../../lib/utils';
import { NO_PROFILE } from '../../lib/leadFilters';
import type { LeadFilters } from '../../lib/leadFilters';
import type { IdealCustomerProfile, Profile } from '../../types';
import type { Stage } from '../../types';
import { MultiSelect } from '../ui/MultiSelect';
import { useOrg } from '../../hooks/useOrg';

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  profiles: Profile[];
  /** The org's customer profiles; the profile filter only shows when there are some. */
  icps?: IdealCustomerProfile[];
}

/** Search + stage/assignee multi-selects + overdue toggle (SPEC.md §6 list view). */
export function FilterBar({ filters, onChange, profiles, icps = [] }: FilterBarProps) {
  const { currentOrg } = useOrg();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          aria-label="Search leads"
          placeholder="Search company, owner, email…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="min-h-11 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-base outline-none placeholder:text-muted focus:border-cyan"
        />
      </div>
      <MultiSelect
        label="Stage"
        options={STAGES.map((s) => ({ value: s.value, label: s.label }))}
        selected={filters.stages}
        onChange={(stages) => onChange({ ...filters, stages: stages as Stage[] })}
      />
      {icps.length > 0 && (
        <MultiSelect
          label="Customer profile"
          options={[...icps.map((p) => ({ value: p.id, label: p.name })), { value: NO_PROFILE, label: 'No profile' }]}
          selected={filters.icps ?? []}
          onChange={(selectedIcps) => onChange({ ...filters, icps: selectedIcps })}
        />
      )}
      {currentOrg?.role === 'admin' && (
        <MultiSelect
          label="Assigned to"
          options={profiles.map((p) => ({ value: p.id, label: p.full_name ?? p.email }))}
          selected={filters.assignees}
          onChange={(assignees) => onChange({ ...filters, assignees })}
        />
      )}
      <button
        type="button"
        onClick={() => onChange({ ...filters, overdueOnly: !filters.overdueOnly })}
        aria-pressed={filters.overdueOnly}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${filters.overdueOnly ? 'border-red-400 text-danger' : 'border-line text-muted'}`}
      >
        <AlertCircle className="h-4 w-4" aria-hidden />
        Overdue only
      </button>
    </div>
  );
}
