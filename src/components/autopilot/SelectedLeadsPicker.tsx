import { useSelectableLeads } from '../../hooks/useSelectableLeads';
import { Card } from '../ui/Card';
import { PipelineSection } from './PipelineSection';

interface Props {
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  /** IANA zone used to decide what counts as "due today". */
  timeZone: string;
}

/** Pick the leads autopilot should work through, grouped by pipeline. */
export function SelectedLeadsPicker({ value, onChange, timeZone }: Props) {
  const { loading, error, byPipeline } = useSelectableLeads(timeZone);

  if (loading) return <p className="text-sm text-muted" role="status">Loading your leads…</p>;
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (byPipeline.length === 0) {
    return <Card><p className="text-sm text-muted">No leads yet. Add leads to a pipeline first, then come back to pick the ones to work through.</p></Card>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{value.size} selected</p>
      {byPipeline.map((group) => (
        <PipelineSection key={group.pipelineId} group={group} value={value} onChange={onChange} />
      ))}
    </div>
  );
}
