import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PipelineGroup } from '../../lib/selectableLeads';
import { setIds } from '../../lib/selectableLeads';
import { filterPickerGroups, selectMatching, selectedSummary, type PickerFilters } from '../../lib/autopilotPicker';
import { Card } from '../ui/Card';
import { PipelineSection } from './PipelineSection';
import { PickerFilterBar, CONTACT_OPTIONS } from './PickerFilterBar';
import { PickerSelectionBar } from './PickerSelectionBar';

interface Props {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  data: { loading: boolean; error: string | null; byPipeline: PipelineGroup[]; hasOrg: boolean; pipelines: { id: string; name: string }[] };
  filters: PickerFilters;
  onFiltersChange: (next: PickerFilters) => void;
  now: Date;
  timeZone: string;
}
const EMPTY_SELECTION = new Set<string>();

/** Filter the displayed list while preserving the parent's complete cross-pipeline selection. */
export function SelectedLeadsPicker({ value, onChange, data, filters, onFiltersChange, now, timeZone }: Props) {
  const { loading, error, byPipeline, hasOrg } = data;
  const [search, setSearch] = useState(filters.search);
  useEffect(() => { const timer = setTimeout(() => setSearch(filters.search), 150); return () => clearTimeout(timer); }, [filters.search]);
  const selectionFilter = filters.selectedOnly ? value : EMPTY_SELECTION;
  const { pipelineIds, contact, stages, readiness, verifiedEmail, hideIneligible, selectedOnly } = filters;
  const matching = useMemo(() => filterPickerGroups(byPipeline, { search, pipelineIds, contact, stages, readiness, verifiedEmail, hideIneligible, selectedOnly },
    selectionFilter, now, timeZone), [byPipeline, search, pipelineIds, contact, stages, readiness, verifiedEmail, hideIneligible, selectedOnly, selectionFilter, now, timeZone]);
  const summary = useMemo(() => selectedSummary(value, byPipeline, matching), [value, byPipeline, matching]);
  const onToggle = useCallback((id: string, on: boolean) => onChange(setIds(value, [id], on)), [value, onChange]);
  const total = byPipeline.reduce((sum, group) => sum + group.leads.length, 0);
  const shown = matching.reduce((sum, group) => sum + group.leads.length, 0);
  const active = [search.trim() && `Search: ${search.trim()}`, pipelineIds !== null && `${pipelineIds.length} pipelines`, contact !== 'any' && CONTACT_OPTIONS.find(c => c.value === contact)?.label,
    stages.length > 0 && `${stages.length} stages`, readiness.length > 0 && `${readiness.length} readiness levels`, verifiedEmail && 'Verified email', hideIneligible && 'Eligible only', selectedOnly && 'Selected only'].filter(Boolean);

  if (!hasOrg) return <Card><p className="text-sm text-muted">Select an organisation first.</p></Card>;
  if (loading) return <p className="text-sm text-muted" role="status">Loading your leads…</p>;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  return <div className="flex min-w-0 flex-col gap-4">
    <PickerSelectionBar {...summary} matching={matching.reduce((sum, group) => sum + group.eligible.length, 0)} selectedOnly={selectedOnly}
      onSelectAll={() => onChange(selectMatching(value, matching))} onClear={() => onChange(new Set())}
      onSelectedOnly={on => onFiltersChange({ ...filters, selectedOnly: on })} />
    <Card><PickerFilterBar value={filters} onChange={onFiltersChange} pipelines={data.pipelines} /></Card>
    <p role="status" className="break-words text-sm text-muted">Showing {shown} of {total} leads{active.length > 0 ? ` · ${active.join(' · ')}` : ''}</p>
    {total === 0 ? <Card><p className="text-sm text-muted">No leads yet. Add leads to a pipeline first, then come back to pick the ones to work through.</p></Card>
      : shown === 0 && <Card><p className="text-sm text-muted">No leads match these filters</p></Card>}
    {matching.map(group => <PipelineSection key={group.pipelineId} group={group} value={value} onChange={onChange} onToggle={onToggle} now={now} />)}
  </div>;
}
