import type {ActionResolution} from '../../hooks/useDreamAgentSession';
import type {DecisionMakerCandidate,DreamAgentAction,Lead,Pipeline} from '../../types';
import type {AgentConfirmHandle} from '../../lib/dreamAgentBulk';
export interface ActionRowProps {
  onBulkReady?:(handle:AgentConfirmHandle|null)=>void;
  action: DreamAgentAction;
  resolution: ActionResolution;
  leadsById: Record<string, Lead>;
  pipelines: Pipeline[];
  /** The single pipeline the user scoped this note to ("Match against"), or null
   * for whole-platform mode. A `create`/`ambiguous-as-new` action targets THIS
   * pipeline automatically when set — it must never fall back to an arbitrary
   * pipeline (e.g. pipelines[0]), which would silently create the lead in the
   * wrong place. */
  scopedPipelineId: string | null;
  needsPipelinePicker: boolean;
  /** update_company_context can only be CONFIRMED by an org admin (matching the
   * RLS gate on organizations.company_context) — any rep can still have it
   * proposed and see it, since useful context can come from anyone. */
  isOrgAdmin: boolean;
  onResolve: (resolution: ActionResolution) => void;
  /** Ambiguous rows only: the user chose which lead they meant. */
  onPickLead: (leadId: string) => void;
  /** Customer profile id to name, so a proposed profile reads as a name. */
  icpNames?: Record<string, string>;
  /** Live contacts per lead, for contact rows (an update shows the contact as it is now). */
  contactsByLead?: Record<string, DecisionMakerCandidate[]>;
  /** The conversation so far (the user's own messages). */
  messages?: string[];
}

