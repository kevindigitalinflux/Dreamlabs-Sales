import { useMemo, useState } from 'react';
import { AlertCircle, ListFilter, Search, X } from 'lucide-react';
import { STAGES } from '../../lib/utils';
import { NO_PROFILE } from '../../lib/leadFilters';
import type { LeadFilters } from '../../lib/leadFilters';
import { activeFilterTags } from '../../lib/activeFilterTags';
import type { IdealCustomerProfile, Profile, Stage } from '../../types';
import { ToggleChip } from '../ui/ToggleChip';
import { MultiSelect } from '../ui/MultiSelect';
import { Button } from '../ui/Button';
import { useOrg } from '../../hooks/useOrg';

interface FilterBarProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  profiles: Profile[];
  /** The org's customer profiles; the profile filter only shows when there are some. */
  icps?: IdealCustomerProfile[];
  /** Leads that pass the filters, and all leads in the pipeline, for the "7 of 141 leads" count. */
  shown: number;
  total: number;
}

/**
 * Search, one Filters button that opens the full set of filters, the active filters as removable tags, and the
 * lead count. Replaces the row of eight always-visible filters.
 */
export function FilterBar({ filters, onChange, profiles, icps = [], shown, total }: FilterBarProps) {
  const { currentOrg } = useOrg();
  const [open, setOpen] = useState(false);
  const tags = useMemo(() => activeFilterTags(filters, {
    assignee: (id) => { const p = profiles.find((x) => x.id === id); return p?.full_name ?? p?.email ?? 'Someone'; },
    icp: (id) => icps.find((p) => p.id === id)?.name ?? 'Profile',
  }), [filters, profiles, icps]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search company, owner, email"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
            className="min-h-11 w-full rounded-control border border-line bg-raised pl-9 pr-3 text-base outline-none placeholder:text-muted focus:border-focus md:min-h-10"
          />
        </div>
        <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ListFilter className="h-4 w-4" aria-hidden />
          Filters{tags.length > 0 ? ` (${tags.length})` : ''}
        </Button>
        {tags.map((tag) => (
          <span key={tag.key} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-surface pl-3 pr-1 text-[13px] font-medium">
            {tag.label}
            <button type="button" onClick={() => onChange(tag.remove(filters))} aria-label={`Remove filter: ${tag.label}`} className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-line hover:text-offwhite focus-visible:outline-2 focus-visible:outline-focus">
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </span>
        ))}
        <span className="ml-auto text-sm text-muted" aria-live="polite">{shown} of {total} {total === 1 ? 'lead' : 'leads'}</span>
      </div>
      {open && (
        <div className="flex flex-wrap items-center gap-3 rounded-surface border border-line bg-raised p-3">
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
          <MultiSelect
            label="Readiness"
            options={[{ value: 'ready', label: 'Ready' }, { value: 'almost', label: 'Almost' }, { value: 'needs_work', label: 'Needs work' }, { value: 'not_checked', label: 'Not checked' }]}
            selected={filters.readiness ?? []}
            onChange={(readiness) => onChange({ ...filters, readiness: readiness as LeadFilters['readiness'] })}
          />
          <ToggleChip tone="attention" pressed={!!filters.overdueOnly} onPressedChange={(overdueOnly) => onChange({ ...filters, overdueOnly })}>
            <AlertCircle className="h-4 w-4" aria-hidden />
            Overdue only
          </ToggleChip>
          <ToggleChip pressed={!!filters.hasPhone} onPressedChange={(hasPhone) => onChange({ ...filters, hasPhone })}>Has phone</ToggleChip>
          <ToggleChip pressed={!!filters.hasDirectLine} onPressedChange={(hasDirectLine) => onChange({ ...filters, hasDirectLine })}>Has direct line</ToggleChip>
          <ToggleChip pressed={!!filters.needsLookOnly} onPressedChange={(needsLookOnly) => onChange({ ...filters, needsLookOnly })}>Needs a look</ToggleChip>
        </div>
      )}
    </div>
  );
}
