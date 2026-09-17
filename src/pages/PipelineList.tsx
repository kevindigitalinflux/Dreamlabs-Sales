import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Inbox, Plus, Radar } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { useLeadEnrichment } from '../hooks/useLeadEnrichment';
import { usePipeline } from '../hooks/usePipeline';
import { filterLeads, sortLeads } from '../lib/leadFilters';
import type { LeadFilters, SortKey } from '../lib/leadFilters';
import { STAGES } from '../lib/utils';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { EnrichmentReview } from '../components/pipeline/EnrichmentReview';
import { FilterBar } from '../components/pipeline/FilterBar';
import { ListTable } from '../components/pipeline/ListTable';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { SharedPipelineBanner } from '../components/pipeline/SharedPipelineBanner';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import { PipelineSwitcher } from '../components/layout/PipelineSwitcher';
import type { EnrichableField, EnrichmentResult, Lead, Stage } from '../types';

/** List pipeline view: search, filters, sortable table, side panel (SPEC.md §6). */
export function PipelineList() {
  const { leads, loading, error, createLead, updateLead } = useLeads();
  const { profiles } = useProfiles();
  const { currentPipeline } = usePipeline();
  const [searchParams] = useSearchParams();
  const urlStage = searchParams.get('stage');
  const initialStages = STAGES.some((s) => s.value === urlStage) ? [urlStage as Stage] : [];

  const [filters, setFilters] = useState<LeadFilters>({ search: '', stages: initialStages, assignees: [], overdueOnly: false });
  const [sortKey, setSortKey] = useState<SortKey>('business_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { running: enriching, error: enrichError, runEnrichment } = useLeadEnrichment();
  const [enrichResults, setEnrichResults] = useState<EnrichmentResult[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const leadsById = useMemo(() => Object.fromEntries(leads.map((l) => [l.id, l])), [leads]);

  useEffect(() => {
    if (openLead) setOpenLead(leads.find((l) => l.id === openLead.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  useEffect(() => {
    setSelected(new Set());
  }, [filters, currentPipeline?.id]);

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

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((l) => l.id))));
  }

  async function handleFillMissingDetails() {
    const results = await runEnrichment([...selected]);
    if (results === null) return;
    setEnrichResults(results);
    setReviewOpen(true);
  }

  async function handleApplyEnrichment(grouped: Record<string, Partial<Record<EnrichableField, string>>>) {
    let applied = 0;
    const failed: { leadId: string; error: string }[] = [];
    for (const [leadId, patch] of Object.entries(grouped)) {
      const err = await updateLead(leadId, patch);
      if (err) failed.push({ leadId, error: err }); else applied++;
    }
    if (failed.length === 0) setSelected(new Set());
    return { applied, failed };
  }

  return (
    <div className="flex flex-col gap-4">
      <SharedPipelineBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Pipeline</h1>
          <PipelineSwitcher />
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle current="list" />
          {selected.size > 0 && (
            <Button variant="secondary" onClick={() => void handleFillMissingDetails()} disabled={enriching}>
              <Radar className="h-4 w-4" aria-hidden />
              {enriching ? 'Searching…' : `Fill missing details (${selected.size})`}
            </Button>
          )}
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} profiles={profiles.filter((p) => p.role === 'contractor')} />

      {loading && <Skeleton className="h-64 w-full" />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {enrichError && <p role="alert" className="text-sm text-danger">{enrichError}</p>}
      {!loading && !error && visible.length === 0 && (
        <EmptyState
          icon={Inbox}
          title={leads.length === 0 ? 'No leads yet' : 'No leads match these filters'}
          hint={leads.length === 0 ? 'Add your first lead to start working the pipeline.' : 'Clear a filter or two and try again.'}
          action={leads.length === 0 ? <Button onClick={() => setWizardOpen(true)}>Add lead</Button> : undefined}
        />
      )}
      {!loading && !error && visible.length > 0 && (
        <ListTable
          leads={visible}
          profiles={profiles}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          onOpen={setOpenLead}
          selected={selected}
          onToggle={toggleSelected}
          onToggleAll={toggleSelectAll}
        />
      )}

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
      <LeadPanel lead={openLead} profiles={profiles} onClose={() => setOpenLead(null)} onUpdate={updateLead} />
      <EnrichmentReview
        open={reviewOpen}
        results={enrichResults}
        leadsById={leadsById}
        onClose={() => setReviewOpen(false)}
        onApply={handleApplyEnrichment}
      />
    </div>
  );
}
