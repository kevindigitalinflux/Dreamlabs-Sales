import { STAGES, dueLabel, formatCurrency, isOverdue, packageLabel } from '../../lib/utils';
import type { LeadPatch } from '../../lib/leadUpdates';
import type { OrgProfile } from '../../hooks/useProfiles';
import type { Lead, Stage } from '../../types';
import { Collapsible } from '../ui/Collapsible';
import { SelectField } from '../ui/Input';
import { ContactInfo, PipelineInfo } from './LeadPanelSections';
import { NextActionEditor } from './NextActionEditor';
import { EnrollmentControl } from '../emails/EnrollmentControl';
import { PainPointCard } from './PainPointCard';

interface Props {
  lead: Lead;
  profiles: OrgProfile[];
  isAdmin: boolean;
  /** Changes when notes change, so the pain point card refreshes. */
  notesKey: unknown;
  onSave: (patch: LeadPatch) => Promise<string | null>;
}

/** Overview tab: the next action first, then everything else folded away with a one-line summary of what is inside. */
export function LeadPanelOverview({ lead, profiles, isAdmin, notesKey, onSave }: Props) {
  const overdue = isOverdue(lead.next_action_date);
  const contactHint = [lead.phone ? 'Phone' : null, lead.email ? 'Email' : null, lead.website ? 'Website' : null].filter(Boolean).join(', ') || 'None yet';
  const dealHint = [packageLabel(lead.package_tier), lead.deal_value !== null ? formatCurrency(lead.deal_value) : null].filter((x) => x && x !== 'None').join(', ') || 'Nothing set';
  return (
    <div className="flex flex-col gap-2">
      <div className={`rounded-nested p-4 ${overdue ? 'bg-attention-soft' : 'bg-surface'}`}>
        <b className="block">{lead.next_action_note ?? 'No next action set'}</b>
        {lead.next_action_date && <span className={`text-[13px] ${overdue ? 'font-medium text-attention' : 'text-muted'}`}>{dueLabel(lead.next_action_date)}</span>}
      </div>
      <Collapsible title="Change next action" summary="Date and note"><NextActionEditor lead={lead} onSave={onSave} /></Collapsible>
      <Collapsible title="Contact details" summary={contactHint}><ContactInfo lead={lead} onSave={onSave} /></Collapsible>
      <Collapsible title="Deal" summary={dealHint}>
        <div className="flex flex-col gap-4">
          <SelectField label="Move to stage" value={lead.stage} onChange={(e) => void onSave({ stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </SelectField>
          <PipelineInfo lead={lead} onSave={onSave} />
          {isAdmin && (
            <SelectField label="Assigned to" value={lead.assigned_to ?? ''} onChange={(e) => void onSave({ assigned_to: e.target.value || null })}>
              <option value="">Unassigned</option>
              {profiles.filter((p) => p.role !== 'admin').map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
            </SelectField>
          )}
        </div>
      </Collapsible>
      <Collapsible title="Follow-up emails" summary="Sequence and pain point">
        <div className="flex flex-col gap-4">
          <EnrollmentControl lead={lead} />
          <PainPointCard leadId={lead.id} icpId={lead.icp_id} refreshKey={notesKey} />
        </div>
      </Collapsible>
    </div>
  );
}
