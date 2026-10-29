import { memo, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { selectionState, setIds, type PipelineGroup } from '../../lib/selectableLeads';
import { PickerLeadRow } from './PickerLeadRow';

interface Props {
  group: PipelineGroup;
  value: Set<string>;
  onChange: (next: Set<string>) => void;
  onToggle: (id: string, on: boolean) => void;
  now: Date;
}

/** Collapsible pipeline with bounded rendering and bulk selection limited to filtered eligible leads. */
export const PipelineSection = memo(function PipelineSection({ group, value, onChange, onToggle, now }: Props) {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState(100);
  const id = useId();
  const ids = group.leads.filter(lead => lead.eligible).map(lead => lead.id);
  const state = selectionState(ids, value);
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = state === 'some'; }, [state]);
  useEffect(() => { setLimit(100); }, [group.leads]);
  return <Card>
    <section aria-label={group.pipelineName} className="flex min-w-0 flex-col gap-2">
      <h2><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-lg p-2 text-left font-semibold hover:bg-surface focus-visible:outline-2 focus-visible:outline-violet-line">
        <span className="min-w-0 break-words">{group.pipelineName} ({group.leads.length})</span>
        <ChevronDown aria-hidden className={`h-4 w-4 shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button></h2>
      <div id={id} hidden={!open}>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input ref={allRef} type="checkbox" checked={state === 'all'} disabled={ids.length === 0}
            onChange={e => onChange(setIds(value, ids, e.target.checked))}
            className="h-4 w-4 accent-violet-500 focus-visible:outline-2 focus-visible:outline-violet-line" />
          Select all in this pipeline ({ids.length})
        </label>
        {open && <div className="flex min-w-0 flex-col divide-y divide-line">
          {group.leads.slice(0, limit).map(lead => <PickerLeadRow key={lead.id} lead={lead} checked={value.has(lead.id)} onToggle={onToggle} now={now} />)}
          {limit < group.leads.length && <Button variant="secondary" onClick={() => setLimit(n => n + 100)}>Show more ({group.leads.length - limit} remaining)</Button>}
        </div>}
      </div>
    </section>
  </Card>;
});
