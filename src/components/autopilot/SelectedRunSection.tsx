import { useState } from 'react';
import { Link } from 'react-router';
import { useAutopilotRunLeads } from '../../hooks/useAutopilotRunLeads';
import { useDraftStatuses } from '../../hooks/useDraftStatuses';
import { NEEDS_INPUT_CHANGED_EVENT } from '../../hooks/useNeedsInputCount';
import { useAuth } from '../../hooks/useAuth';
import { applyDraftResolution } from '../../lib/runLeadGroups';
import type { AutopilotRun } from '../../types';
import { RunHeader } from './RunHeader';
import { RunLeadGroups } from './RunLeadGroups';
import { NeedsInputRow } from './NeedsInputRow';

interface SelectedRunSectionProps {
  run: AutopilotRun;
  refresh: () => Promise<void>;
  stopRun: () => Promise<string | null>;
}

/**
 * Status of a selected-leads run: header card plus its leads in groups, live via realtime.
 * Needs-input rows are resolved from their draft's current status (nothing is written back to the run).
 */
export function SelectedRunSection({ run, refresh, stopRun }: SelectedRunSectionProps) {
  const { session } = useAuth();
  const leads = useAutopilotRunLeads(run.id, () => void refresh());
  const draftIds = leads.rows.filter((r) => r.status === 'needs_input' && r.email_log_id).map((r) => r.email_log_id as string);
  const drafts = useDraftStatuses(draftIds);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const lookup = drafts.error !== null ? 'failed' : drafts.ready ? 'ready' : 'checking';
  const rows = applyDraftResolution(leads.rows, drafts.statuses, lookup);

  return (
    <div className="flex flex-col gap-4">
      <RunHeader run={run} rows={rows} onStop={stopRun} />
      {run.status !== 'active' && (
        <Link to="/outreach/autopilot/new" className="text-sm font-semibold text-cyan hover:underline">Start a new run</Link>
      )}
      {drafts.error && <p role="alert" className="text-sm text-danger">Could not check which parked drafts were sent: {drafts.error}</p>}
      {followUpError && <p role="alert" className="text-sm text-danger">{followUpError}</p>}
      <RunLeadGroups
        rows={rows}
        loading={leads.loading}
        error={leads.error}
        renderNeedsInputAction={(row) => (
          <NeedsInputRow
            row={row}
            onChanged={(err, sent) => {
              setFollowUpError(err);
              void drafts.refresh();
              if (sent) window.dispatchEvent(new Event(NEEDS_INPUT_CHANGED_EVENT));
            }}
            onRetry={() => void drafts.refresh()}
            canReview={!!session?.user.id && session.user.id === run.created_by}
          />
        )}
      />
    </div>
  );
}
