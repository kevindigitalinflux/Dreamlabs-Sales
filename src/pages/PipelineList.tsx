import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Download, Inbox, PenLine, Plus, Radar, Tag, Telescope, Trash2, UserSearch } from 'lucide-react';
import { supabase } from '../lib/supabase';
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
import { Listbox } from '../components/ui/Listbox';
import { AddLeadWizard } from '../components/pipeline/AddLeadWizard';
import { BulkDraftModal } from '../components/pipeline/BulkDraftModal';
import { BulkProfileModal } from '../components/pipeline/BulkProfileModal';
import { useIcps } from '../hooks/useIcps';
import { DeepFindModal } from '../components/deepfind/DeepFindModal';
import { DeepFindRunsLink } from '../components/deepfind/DeepFindRunsLink';
import { useDeepFindActivity } from '../hooks/useDeepFindActivity';
import { DEEP_FIND_MAX_LEADS } from '../lib/deepFindView';
import { FilterBar } from '../components/pipeline/FilterBar';
import { ListTable } from '../components/pipeline/ListTable';
import { LeadPanel } from '../components/pipeline/LeadPanel';
import { SharedPipelineBanner } from '../components/pipeline/SharedPipelineBanner';
import { ViewToggle } from '../components/pipeline/ViewToggle';
import { PipelineSwitcher } from '../components/layout/PipelineSwitcher';
import type { Lead, Stage } from '../types';

/** List pipeline view: search, filters, sortable table, side panel (SPEC.md §6). */
export function PipelineList() {
  const { leads, loading, error, createLead, updateLead, refresh } = useLeads();
  const { profiles } = useProfiles();
  const { currentPipeline, pipelines } = usePipeline();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlStage = searchParams.get('stage');
  const initialStages = STAGES.some((s) => s.value === urlStage) ? [urlStage as Stage] : [];

  const [filters, setFilters] = useState<LeadFilters>({ search: '', stages: initialStages, assignees: [], overdueOnly: false, icps: [] });
  const { icps } = useIcps();
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('business_name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [openLead, setOpenLead] = useState<Lead | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { running: enriching, error: enrichError, runEnrichment } = useLeadEnrichment();
  const [draftModalOpen, setDraftModalOpen] = useState(false);
  const { searching: findingDecisionMakers, error: decisionMakerError, runSearch } = useDecisionMakers();
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [deepFindOpen, setDeepFindOpen] = useState(false);
  const deepFind = useDeepFindActivity(currentPipeline?.org_id ?? null);
  const [moveTargetId, setMoveTargetId] = useState('');
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const leadsById = useMemo(() => Object.fromEntries(leads.map((l) => [l.id, l])), [leads]);
  const otherPipelines = currentPipeline
    ? pipelines.filter((p) => p.org_id === currentPipeline.org_id && p.id !== currentPipeline.id)
    : [];

  useEffect(() => {
    if (openLead) setOpenLead(leads.find((l) => l.id === openLead.id) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads]);

  useEffect(() => {
    setSelected(new Set());
    setBulkError(null);
    setLookupNotice(null);
  }, [filters, currentPipeline?.id]);

  // Arrives via navigate(..., { state: { selectAllOnLoad: true } }) — e.g. Pipeline
  // Manage's "delete blocked, go move its leads" link. Waits for this pipeline's
  // leads to actually finish loading (switching pipeline triggers a refetch), then
  // clears the nav state so it can't re-trigger on a later remount or back-nav.
  useEffect(() => {
    const state = location.state as { selectAllOnLoad?: boolean } | null;
    if (state?.selectAllOnLoad && !loading) {
      setSelected(new Set(leads.map((l) => l.id)));
      navigate(location.pathname + location.search, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, leads]);

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
    setLookupNotice(null);
    const job = await runEnrichment([...selected]);
    if (job) setLookupNotice(`Started: ${job.queued} leads. Follow it in Jobs.`);
  }

  async function handleFindDecisionMaker() {
    setLookupNotice(null);
    const job = await runSearch([...selected]);
    if (job) setLookupNotice(`Started: ${job.queued} leads. Follow it in Jobs.`);
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

  async function handleMoveSelected() {
    if (!moveTargetId) return;
    setBulkError(null);
    setMoving(true);
    let failed = 0;
    for (const leadId of selected) {
      const err = await updateLead(leadId, { pipeline_id: moveTargetId });
      if (err) failed++;
    }
    setMoving(false);
    setMoveTargetId('');
    if (failed > 0) setBulkError(`Moved ${selected.size - failed} of ${selected.size} leads — ${failed} failed.`);
    else setSelected(new Set());
  }

  async function handleDeleteSelected() {
    const count = selected.size;
    if (!window.confirm(`Permanently delete ${count} lead${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    setBulkError(null);
    setDeleting(true);
    // .select('id') matters here, not just for the count: a plain .delete() reports
    // no error when RLS silently matches 0 rows, which would otherwise look like a
    // successful delete of leads that were never actually removed.
    const { data, error: err } = await supabase.from('leads').delete().in('id', [...selected]).select('id');
    setDeleting(false);
    await refresh();
    if (err) { setBulkError('Could not delete the selected leads. Please try again.'); return; }
    const deletedCount = data?.length ?? 0;
    if (deletedCount < count) setBulkError(`Deleted ${deletedCount} of ${count} leads — you may not have permission to delete the rest.`);
    else setSelected(new Set());
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
          <DeepFindRunsLink attention={deepFind.attention} running={deepFind.running.size} />
          <Button variant="secondary" onClick={handleExportCsv} disabled={visible.length === 0}>
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
          <Button onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add lead
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/40 p-3">
          <span className="text-sm font-semibold">{selected.size} selected</span>
          <Button variant="secondary" onClick={() => void handleFillMissingDetails()} disabled={enriching || selected.size > 50} loading={enriching} title={selected.size > 50 ? 'Choose up to 50 leads per lookup' : undefined}>
            <Radar className="h-4 w-4" aria-hidden />
            {enriching ? 'Starting…' : 'Fill missing details'}
          </Button>
          <Button variant="secondary" onClick={() => setDraftModalOpen(true)}>
            <PenLine className="h-4 w-4" aria-hidden />
            Draft emails
          </Button>
          {icps.length > 0 && (
            <Button variant="secondary" onClick={() => setProfileModalOpen(true)}>
              <Tag className="h-4 w-4" aria-hidden />
              Customer profile
            </Button>
          )}
          <Button variant="secondary" onClick={() => void handleFindDecisionMaker()} disabled={findingDecisionMakers || selected.size > 50} loading={findingDecisionMakers} title={selected.size > 50 ? 'Choose up to 50 leads per lookup' : undefined}>
            <UserSearch className="h-4 w-4" aria-hidden />
            {findingDecisionMakers ? 'Starting…' : 'Find decision maker'}
          </Button>
          <Button variant="secondary" onClick={() => setDeepFindOpen(true)} disabled={selected.size > DEEP_FIND_MAX_LEADS}
            title={selected.size > DEEP_FIND_MAX_LEADS ? `Deep find works on ${DEEP_FIND_MAX_LEADS} leads or fewer at a time` : undefined}>
            <Telescope className="h-4 w-4" aria-hidden />
            Deep find
          </Button>
          {otherPipelines.length > 0 && (
            <div className="flex items-center gap-2">
              <Listbox
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                ariaLabel="Move selected leads to pipeline"
                fullWidth={false}
                className="min-w-40"
              >
                <option value="">Move to…</option>
                {otherPipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Listbox>
              <Button variant="secondary" onClick={() => void handleMoveSelected()} disabled={!moveTargetId || moving} loading={moving}>
                {moving ? 'Moving…' : 'Move'}
              </Button>
            </div>
          )}
          <Button variant="danger" onClick={() => void handleDeleteSelected()} disabled={deleting} loading={deleting}>
            <Trash2 className="h-4 w-4" aria-hidden />
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
          <Button variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      )}

      <FilterBar filters={filters} onChange={setFilters} profiles={profiles.filter((p) => p.role === 'contractor')} icps={icps} />

      {loading && <Skeleton className="h-64 w-full" />}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {bulkError && <p role="alert" className="text-sm text-danger">{bulkError}</p>}
      {lookupNotice && <p role="status" className="text-sm text-success">{lookupNotice} <Link to="/jobs" className="underline">View Jobs</Link></p>}
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
          deepFindRunning={deepFind.running}
        />
      )}

      <AddLeadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onCreate={createLead} />
      <LeadPanel lead={openLead} profiles={profiles} onClose={() => setOpenLead(null)} onUpdate={updateLead} />
      <BulkProfileModal
        open={profileModalOpen}
        leads={[...selected].map((id) => leadsById[id]).filter((l): l is Lead => l !== undefined)}
        icps={icps}
        onClose={() => setProfileModalOpen(false)}
        onAssign={(leadId, icpId) => updateLead(leadId, { icp_id: icpId })}
        onDone={() => setSelected(new Set())}
      />
      <BulkDraftModal
        open={draftModalOpen}
        leads={[...selected].map((id) => leadsById[id]).filter((l): l is Lead => l !== undefined)}
        onClose={() => setDraftModalOpen(false)}
        onGenerated={() => setSelected(new Set())}
      />
      <DeepFindModal open={deepFindOpen} leadIds={[...selected]} onClose={() => setDeepFindOpen(false)} />
    </div>
  );
}
