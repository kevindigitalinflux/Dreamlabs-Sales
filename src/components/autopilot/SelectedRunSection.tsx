import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAutopilotRunLeads } from '../../hooks/useAutopilotRunLeads';
import type { RunLeadRow } from '../../hooks/useAutopilotRunLeads';
import type { AutopilotRun } from '../../types';
import { RunHeader } from './RunHeader';
import { RunLeadGroups } from './RunLeadGroups';

interface SelectedRunSectionProps {
  run: AutopilotRun;
  refresh: () => Promise<void>;
  stopRun: () => Promise<string | null>;
  /** Slot for the action on each "Needs your input" row. */
  renderNeedsInputAction?: (row: RunLeadRow) => ReactNode;
}

/** Status of a selected-leads run: header card plus its leads in groups, live via realtime. */
export function SelectedRunSection({ run, refresh, stopRun, renderNeedsInputAction }: SelectedRunSectionProps) {
  const leads = useAutopilotRunLeads(run.id, () => void refresh());
  return (
    <div className="flex flex-col gap-4">
      <RunHeader run={run} rows={leads.rows} onStop={stopRun} />
      {run.status !== 'active' && (
        <Link to="/outreach/autopilot/new" className="text-sm font-semibold text-cyan hover:underline">Start a new run</Link>
      )}
      <RunLeadGroups rows={leads.rows} loading={leads.loading} error={leads.error} renderNeedsInputAction={renderNeedsInputAction} />
    </div>
  );
}
