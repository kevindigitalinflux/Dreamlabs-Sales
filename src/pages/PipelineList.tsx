import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Inbox, Plus } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { filterLeads, sortLeads } from '../lib/leadFilters';
import type { LeadFilters, SortKey } from '../lib/leadFilters';
import { STAGES } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { FilterBar } from '../components/pipeline/FilterBar';
import { ListTable } from '../components/pipeline/ListTable';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import type { Lead, Stage } from '../types';

/** List pipeline view: search, filters, sortable table, side panel (SPEC.md §6). */
export function PipelineList() {
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const [searchParams] = useSearchParams();
  const urlStage = searchParams.get('stage');
  const initialStages = STAGES.some((s) => s.value === urlStage) ? [urlStage as Stage] : [];

  const [filters, setFilters] = useState<LeadFilters>({ search: '', stages: initialStages, assignees: [], overdueOnly: false });
  const [sortKey, setSortKey] = useState<SortKey>('business_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<Lead | null>(null);

  useEffect(() => {
    if (selected) setSelected(leads.find((l) => l.id === selected.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  const visible = useMemo(
    () => sortLeads(filterLeads(leads, filters), sortKey, sortDir),
    [leads, filters, sortKey, sortDir],
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Pipeline</h1>
        <div className="flex items-center gap-3">
          <ViewToggle current="list" />
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} profiles={profiles.filter((p) => p.role === 'contractor')} />

      {loading && <Skeleton className="h-64 w-full" />}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
          hint={leads.length === 0 ? 'Add your first lead to start working the pipeline.' : 'Clear a filter or two and try again.'}
          action={leads.length === 0 ? <Button onClick={() => setWizardOpen(true)}>Add lead</Button> : undefined}
        />
      )}
      {!loading && !error && visible.length > 0 && (
        <ListTable leads={visible} profiles={profiles} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} onOpen={setSelected} />
      )}

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
      <LeadPanel lead={selected} profiles={profiles} onClose={() => setSelected(null)} onUpdate={updateLead} />
    </div>
  );
}
