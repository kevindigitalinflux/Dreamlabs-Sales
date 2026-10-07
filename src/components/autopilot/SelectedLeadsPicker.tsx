import type { PipelineGroup } from '../../lib/selectableLeads';
import { Card } from '../ui/Card';
import { PipelineSection } from './PipelineSection';

interface Props {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** Picker data from useSelectableLeads (owned by the parent so submit sees the same list). */
  data: { loading: boolean; error: string | null; byPipeline: PipelineGroup[]; hasOrg: boolean };
  /** Number of selected leads that are currently visible and eligible. */
  count: number;
}

/** Pick the leads autopilot should work through, grouped by pipeline. */
export function SelectedLeadsPicker({ value, onChange, data, count }: Props) {
  const { loading, error, byPipeline, hasOrg } = data;

  if (!hasOrg) return <Card><p className="text-sm text-muted">Select an organization first.</p></Card>;
  if (loading) return <p className="text-sm text-muted" role="status">Loading your leads…</p>;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (byPipeline.length === 0) {
    return <Card><p className="text-sm text-muted">No leads yet. Add leads to a pipeline first, then come back to pick the ones to work through.</p></Card>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{count} selected</p>
      {byPipeline.map((group) => (
        <PipelineSection key={group.pipelineId} group={group} value={value} onChange={onChange} />
      ))}
    </div>
  );
}
