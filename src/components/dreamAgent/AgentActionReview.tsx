import type { ActionResolution } from '../../hooks/useDreamAgentSession';
import type { DreamAgentAction } from '../../types';
import type { ActionRowProps } from './ActionRowTypes';
import { ActionRow } from './ActionRow';

type Common = Omit<ActionRowProps, 'action' | 'resolution' | 'onResolve' | 'onPickLead' | 'onBulkReady'>;

/**
 * The proposed actions, one row each. Each row is confirmed or skipped on its own using its own controls; confirming
 * only stages that row's resolution and the existing "Apply confirmed changes" action writes it. (The tick-box
 * "select several and confirm or skip them together" strip was removed at Kevin's request on 2026-11-17.)
 */
export function AgentActionReview({ actions, resolutions, onResolve, onPickLead, rowProps, busy, applyErrors = {} }: {
  actions: DreamAgentAction[];
  resolutions: Record<number, ActionResolution>;
  onResolve: (index: number, resolution: ActionResolution) => void;
  onPickLead: (index: number, id: string) => void;
  rowProps: Common;
  busy: boolean;
  applyErrors?: Record<number, string>;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {actions.map((action, index) => (
        <div key={index} className="min-w-0">
          <fieldset disabled={busy}>
            <ActionRow
              {...rowProps}
              action={action}
              resolution={resolutions[index] ?? { status: 'pending' }}
              onResolve={(resolution) => onResolve(index, resolution)}
              onPickLead={(id) => onPickLead(index, id)}
            />
          </fieldset>
          {applyErrors[index] && <p role="alert" className="text-sm text-danger">{applyErrors[index]}</p>}
        </div>
      ))}
    </div>
  );
}
