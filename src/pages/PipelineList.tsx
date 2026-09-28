import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Download, Inbox, PenLine, Plus, Radar, UserSearch } from 'lucide-react';
import { useLeads } from '../hooks/useLeads';
import { useProfiles } from '../hooks/useProfiles';
import { useLeadEnrichment } from '../hooks/useLeadEnrichment';
import { useDecisionMakers } from '../hooks/useDecisionMakers';
import { usePipeline } from '../hooks/usePipeline';
import { filterLeads, sortLeads } from '../lib/leadFilters';
import type { LeadFilters, SortKey } from '../lib/leadFilters';
import { STAGES, packageLabel, stageInfo } from '../lib/utils';
import { toCsv } from '../lib/csv';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { BulkDraftModal } from '../components/pipeline/BulkDraftModal';
import { EnrichmentReview } from '../components/pipeline/EnrichmentReview';
import { DecisionMakerReview } from '../components/pipeline/DecisionMakerReview';
import { FilterBar } from '../components/pipeline/FilterBar';
import { ListTable } from '../components/pipeline/ListTable';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { SharedPipelineBanner } from '../components/pipeline/SharedPipelineBanner';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import { PipelineSwitcher } from '../components/layout/PipelineSwitcher';
import type { DecisionMakerCandidate, EnrichableField, EnrichmentResult, Lead, Stage } from '../types';

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
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const { searching: findingDecisionMakers, error: decisionMakerError, runSearch } = useDecisionMakers();
  const [decisionMakerResults, setDecisionMakerResults] = useState<Record<string, DecisionMakerCandidate[]>>({});
  const [decisionMakerReviewOpen, setDecisionMakerReviewOpen] = useState(false);
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

  async function handleFindDecisionMaker() {
    const results = await runSearch([...selected]);
    if (results === null) return;
    setDecisionMakerResults(results);
    setDecisionMakerReviewOpen(true);
  }

  async function handleApplyHunterCandidate(leadId: string, candidate: DecisionMakerCandidate): Promise<string | null> {
    const patch: Record<string, string> = { email: candidate.email! };
    const name = `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim();
    if (name) patch.owner_name = name;
    return updateLead(leadId, patch);
  }

  function handleExportCsv() {
    const headers = [
      'Business', 'Owner', 'Phone', 'Email', 'Website', 'Address', 'City', 'Postcode',
      'Rating', 'Reviews', 'Vertical', 'Stage', 'Package', 'Deal value', 'Assigned to',
      'Next action date', 'Next action note', 'Priority', 'Calls', 'Last contacted', 'Created',
    ];
    const rows = visible.map((l) => [
      l.business_name, l.owner_name ?? '', l.phone ?? '', l.email ?? '', l.website ?? '',
      l.address ?? '', l.city ?? '', l.postcode ?? '',
      l.google_rating?.toString() ?? '', l.review_count?.toString() ?? '', l.vertical ?? '',
      stageInfo(l.stage).label, packageLabel(l.package_tier),
      l.deal_value?.toString() ?? '',
      profiles.find((p) => p.id === l.assigned_to)?.full_name
        ?? profiles.find((p) => p.id === l.assigned_to)?.email ?? '',
      l.next_action_date ?? '', l.next_action_note ?? '', l.is_priority ? 'Yes' : 'No',
      l.call_count.toString(), l.last_contacted_at ?? '', l.created_at,
    ]);
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (currentPipeline?.name ?? 'pipeline').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url; a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <SharedPipelineBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold">Pipeline</h1>
          <PipelineSwitcher />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle current="list" />
          <Button variant="secondary" onClick={handleExportCsv} disabled={visible.length === 0}>
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
          {selected.size > 0 && (
            <>
              <Button variant="secondary" onClick={() => void handleFillMissingDetails()} disabled={enriching} loading={enriching}>
                <Radar className="h-4 w-4" aria-hidden />
                {enriching ? 'Searching…' : `Fill missing details (${selected.size})`}
              </Button>
              <Button variant="secondary" onClick={() => setDraftModalOpen(true)}>
                <PenLine className="h-4 w-4" aria-hidden />
                {`Draft emails (${selected.size})`}
              </Button>
              <Button variant="secondary" onClick={() => void handleFindDecisionMaker()} disabled={findingDecisionMakers} loading={findingDecisionMakers}>
                <UserSearch className="h-4 w-4" aria-hidden />
                {findingDecisionMakers ? 'Searching…' : `Find decision maker (${selected.size})`}
              </Button>
            </>
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
      {decisionMakerError && <p role="alert" className="text-sm text-danger">{decisionMakerError}</p>}
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
      <BulkDraftModal
        open={draftModalOpen}
        leads={[...selected].map((id) => leadsById[id]).filter((l): l is Lead => l !== undefined)}
        onClose={() => setDraftModalOpen(false)}
        onGenerated={() => setSelected(new Set())}
      />
      <DecisionMakerReview
        open={decisionMakerReviewOpen}
        resultsByLead={decisionMakerResults}
        leadsById={leadsById}
        onClose={() => setDecisionMakerReviewOpen(false)}
        onApplyHunter={handleApplyHunterCandidate}
      />
    </div>
  );
}
