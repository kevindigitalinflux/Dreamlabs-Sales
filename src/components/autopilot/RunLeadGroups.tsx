import type { ReactNode } from 'react';
import { Skeleton } from '../ui/Skeleton';
import { groupRunLeads } from '../../lib/runLeadGroups';
import type { RunLeadRow as RunLeadRowData } from '../../hooks/useAutopilotRunLeads';
import { RunLeadRow } from './RunLeadRow';

interface RunLeadGroupsProps {
  rows: RunLeadRowData[];
  loading: boolean;
  error: string | null;
  /** Slot for the action shown on each "Needs your input" row. */
  renderNeedsInputAction?: (row: RunLeadRowData) => ReactNode;
}

/** A selected run's leads in Sent / Needs your input / Skipped / Not reached / Failed / Still queued groups. */
export function RunLeadGroups({ rows, loading, error, renderNeedsInputAction }: RunLeadGroupsProps) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (error) return <p role="alert" className="text-sm text-danger">Could not load the leads for this run: {error}</p>;
  if (rows.length === 0) return <p className="text-sm text-muted">This run has no leads.</p>;

  return (
    <div className="flex flex-col gap-5">
      {groupRunLeads(rows).filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.key} aria-label={g.title} className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{g.title} ({g.rows.length})</h3>
          <ul className="flex flex-col gap-2">
            {g.rows.map((row) => (
              <RunLeadRow key={row.id} row={row} action={g.key === 'needs_input' ? renderNeedsInputAction?.(row) : undefined} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
