import { useEffect, useRef } from 'react';
import { Card } from '../ui/Card';
import { STAGES } from '../../lib/utils';
import { selectionState, setIds, type PipelineGroup, type SelectableLead } from '../../lib/selectableLeads';

interface Props {
  group: PipelineGroup;
  value: Set<string>;
  onChange: (next: Set<string>) => void;
}

function LeadRow({ lead, checked, onToggle }: { lead: SelectableLead; checked: boolean; onToggle: (on: boolean) => void }) {
  const stage = STAGES.find((s) => s.value === lead.stage)?.label ?? lead.stage;
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 shrink-0 accent-violet-500" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{lead.business_name}</span>
        <span className="truncate text-xs text-muted">
          {stage}
          {!lead.email && <span className="ml-2 text-warning">No email yet</span>}
        </span>
      </span>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${lead.reason === 'due' ? 'border-violet text-offwhite' : 'border-line text-muted'}`}>
        {lead.reason === 'due' ? 'Due today' : 'New'}
      </span>
    </label>
  );
}

/** One pipeline's selectable leads with a tri-state "Select all in pipeline" checkbox. */
export function PipelineSection({ group, value, onChange }: Props) {
  const ids = group.eligible.map((l) => l.id);
  const state = selectionState(ids, value);
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = state === 'some'; }, [state]);

  return (
    <Card>
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <h2 className="min-w-0 truncate font-semibold">{group.pipelineName}</h2>
          {ids.length > 0 && (
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm">
              <input ref={allRef} type="checkbox" checked={state === 'all'} onChange={(e) => onChange(setIds(value, ids, e.target.checked))} className="h-4 w-4 accent-violet-500" />
              Select all in pipeline
            </label>
          )}
        </div>
        {ids.length === 0 && <p className="text-sm text-muted">No leads ready to select in this pipeline.</p>}
        <div className="flex flex-col divide-y divide-line">
          {group.eligible.map((lead) => (
            <LeadRow key={lead.id} lead={lead} checked={value.has(lead.id)} onToggle={(on) => onChange(setIds(value, [lead.id], on))} />
          ))}
        </div>
        {group.hiddenCount > 0 && (
          <p className="text-xs text-muted">{group.hiddenCount} hidden (contacted recently, not due, paused or opted out)</p>
        )}
      </div>
    </Card>
  );
}
