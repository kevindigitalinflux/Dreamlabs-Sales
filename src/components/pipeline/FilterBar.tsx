import { AlertCircle, Search } from 'lucide-react';
import { STAGES } from '../../lib/utils';
import type { LeadFilters } from '../../lib/leadFilters';
import type { Profile } from '../../types';
import type { Stage } from '../../types';
import { MultiSelect } from '../ui/MultiSelect';
import { useAuth } from '../../hooks/useAuth';

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  profiles: Profile[];
}

/** Search + stage/assignee multi-selects + overdue toggle (SPEC.md §6 list view). */
export function FilterBar({ filters, onChange, profiles }: FilterBarProps) {
  const { profile: me } = useAuth();
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
      {me?.role === 'admin' && (
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
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${filters.overdueOnly ? 'border-red-400 text-red-400' : 'border-line text-muted'}`}
      >
        <AlertCircle className="h-4 w-4" aria-hidden />
        Overdue only
      </button>
    </div>
  );
}
