import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Skeleton } from '../ui/Skeleton';
import { groupRunLeads } from '../../lib/runLeadGroups';
import type { NeedsInputResolution } from '../../lib/runLeadGroups';
import type { RunLeadRow as RunLeadRowData } from '../../hooks/useAutopilotRunLeads';
import { RunLeadRow } from './RunLeadRow';

/** A run row plus how its parked draft (if any) stands. */
export type ResolvedRunLeadRow = RunLeadRowData & { resolution: NeedsInputResolution };

interface RunLeadGroupsProps {
  rows: ResolvedRunLeadRow[];
  loading: boolean;
  error: string | null;
  /** Slot for the action shown on each "Needs your input" row. */
  renderNeedsInputAction?: (row: ResolvedRunLeadRow) => ReactNode;
}

/** A selected run's leads in Sent / Needs your input / Skipped / Not reached / Failed / Still queued groups. */
export function RunLeadGroups({ rows, loading, error, renderNeedsInputAction }: RunLeadGroupsProps) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-danger">Could not load the leads for this run: {error}</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">This run has no leads.</p>;

  return (
    <div className="flex flex-col gap-5">
      {groupRunLeads(rows).filter((g) => g.rows.length > 0).map((g) => (
        <RunGroup key={g.key} title={g.title} count={g.rows.length} alwaysOpen={g.key === 'needs_input'}>
            {g.rows.map((row) => (
              <RunLeadRow key={row.id} row={row} action={g.key === 'needs_input' ? renderNeedsInputAction?.(row) : undefined} />
            ))}
        </RunGroup>
      ))}
    </div>
  );
}

/** Local disclosure state; large groups start closed. */
function RunGroup({title, count, children, alwaysOpen}: {title: string; count: number; children: ReactNode; alwaysOpen: boolean}) {
 const [open, setOpen] = useState(alwaysOpen || count <= 8);
 const id = useId();
 return <section aria-label={title} className="flex flex-col gap-2">
 <h3><button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center justify-between rounded-lg p-2 text-left text-sm font-bold hover:bg-surface focus-visible:outline-2 focus-visible:outline-violet-line">
 {title} ({count})<ChevronDown aria-hidden className={open ? 'h-4 w-4 rotate-180' : 'h-4 w-4'} />
 </button></h3><ul id={id} hidden={!open} className={open ? 'flex flex-col gap-2' : 'hidden'}>{children}</ul></section>;
}
