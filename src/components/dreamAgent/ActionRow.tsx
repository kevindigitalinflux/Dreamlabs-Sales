import { useState } from 'react';
import { ArrowRight, Building2, Sparkles } from 'lucide-react';
import { formatCurrency, packageLabel, stageInfo } from '../../lib/utils';
import { splitContactPatch } from '../../lib/dreamAgentActions';
import { ContactActionRow } from './ContactActionRow';
import { Button } from '../ui/Button';
import { SelectField, Textarea } from '../ui/Input';
import type { ActionResolution } from '../../hooks/useDreamAgentSession';
import type { DecisionMakerCandidate, DreamAgentAction, DreamAgentUpdatePatch, Lead, Pipeline } from '../../types';

interface ActionRowProps {
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
}

const CONTACT_LABELS = { owner_name: 'Owner', phone: 'Phone', email: 'Email', website: 'Website', address: 'Address', city: 'City', postcode: 'Postcode', vertical: 'Business type' };
const ADDITIONAL_LABELS = { owner_name: 'owner', phone: 'phone', email: 'email', website: 'website' };

/** From→to rows for a patch. `lead` is undefined for a lead that doesn't exist yet (a `create`), so every "from" is an em dash. */
function patchRows(patch: DreamAgentUpdatePatch, lead: Lead | undefined, includeContact = false, icpNames: Record<string, string> = {}): { label: string; from: string; to: string }[] {
  const rows: { label: string; from: string; to: string }[] = [];
  if (patch.icp_id && patch.icp_id !== lead?.icp_id) rows.push({ label: 'Customer profile', from: (lead?.icp_id && icpNames[lead.icp_id]) || '—', to: icpNames[patch.icp_id] ?? patch.icp_id });
  if (includeContact) {
    // Existing leads: blanks are filled, differing email/phone/website/owner are kept as additional.
    const { fill, additions } = splitContactPatch(lead, patch);
    for (const [key, value] of Object.entries(fill)) rows.push({ label: CONTACT_LABELS[key as keyof typeof CONTACT_LABELS], from: '—', to: value });
    for (const a of additions) rows.push({ label: `Additional ${ADDITIONAL_LABELS[a.field]}`, from: '—', to: a.value });
  }
  const currentStage = lead?.stage ?? 'new_lead';
  if (patch.stage && patch.stage !== currentStage) rows.push({ label: 'Stage', from: stageInfo(currentStage).label, to: stageInfo(patch.stage).label });
  if (patch.deal_value !== undefined) rows.push({ label: 'Deal value', from: lead?.deal_value != null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(patch.deal_value) });
  if (patch.package_tier) rows.push({ label: 'Package', from: packageLabel(lead?.package_tier ?? null), to: packageLabel(patch.package_tier) });
  if (patch.next_action_date) rows.push({ label: 'Next action date', from: lead?.next_action_date ?? '—', to: patch.next_action_date });
  if (patch.next_action_note) rows.push({ label: 'Next action', from: lead?.next_action_note ?? '—', to: patch.next_action_note });
  if (patch.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: patch.pain_point });
  return rows;
}

/** One proposed action from Dream Agent, resolved by the user before it can be
 * confirmed. `update` renders a from/to diff (matching SuggestionDiff's pattern);
 * `create` shows extracted fields + a pipeline picker if needed; `ambiguous` shows
 * a candidate picker plus "this is someone new", which itself becomes a create-like
 * picker step rather than guessing a pipeline; `update_company_context` shows an
 * editable textarea pre-filled with the AI's proposed merge. */
export function ActionRow({ action, resolution, leadsById, pipelines, scopedPipelineId, needsPipelinePicker, isOrgAdmin, onResolve, onPickLead, icpNames = {}, contactsByLead = {} }: ActionRowProps) {
  const [promotedToNew, setPromotedToNew] = useState(false);
  const [editedContext, setEditedContext] = useState(
    action.type === 'update_company_context' ? action.proposed_context : '',
  );

  if (action.type === 'add_contact' || action.type === 'update_contact') {
    const existing = action.type === 'update_contact' ? (contactsByLead[action.lead_id] ?? []).find((c) => c.id === action.contact_id) : undefined;
    return (
      <ContactActionRow
        key={existing?.id ?? 'new'} action={action} resolution={resolution} existing={existing}
        leadName={leadsById[action.lead_id]?.business_name ?? 'this lead'} onResolve={onResolve}
      />
    );
  }

  if (action.type === 'update_company_context') {
    const confirmed = resolution.status === 'confirmed_update_company_context';
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Building2 className="h-4 w-4 text-cyan" aria-hidden />Update company context</p>
        <p className="text-xs text-muted">{action.rationale}</p>
        <Textarea
          label="Updated company context"
          value={editedContext}
          onChange={(e) => setEditedContext(e.target.value)}
          rows={6}
          disabled={!isOrgAdmin}
        />
        {!isOrgAdmin && (
          <p className="text-xs text-muted">Only an org admin can apply this — flag it to your admin, or dismiss it.</p>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          {isOrgAdmin && (
            <Button
              variant={confirmed ? 'secondary' : 'primary'}
              disabled={!editedContext.trim()}
              onClick={() => onResolve({ status: 'confirmed_update_company_context', edited_context: editedContext })}
            >
              {confirmed ? 'Confirmed ✓' : 'Confirm'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (action.type === 'update') {
    const rows = patchRows(action.patch, leadsById[action.lead_id], true, icpNames);
    const confirmed = resolution.status === 'confirmed_update';
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />{action.business_name}</p>
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
              <span className="w-36 text-xs font-semibold text-muted">{r.label}</span>
              <span className="text-muted line-through">{r.from}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
              <span className="font-semibold text-success">{r.to}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{action.rationale}</p>
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          <Button variant={confirmed ? 'secondary' : 'primary'} onClick={() => onResolve({ status: 'confirmed_update' })}>
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  if (action.type === 'create') {
    const confirmed = resolution.status === 'confirmed_create';
    const pipelineId = resolution.status === 'confirmed_create' ? resolution.pipeline_id : (scopedPipelineId ?? '');
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />New lead: {action.extracted.business_name}</p>
        <p className="text-xs text-muted">{[action.extracted.owner_name, action.extracted.address, action.extracted.city, action.extracted.postcode, action.extracted.phone, action.extracted.email, action.extracted.website, action.extracted.vertical].filter(Boolean).join(' · ') || 'No extra details found'}</p>
        <ul className="flex flex-col gap-1">
          {patchRows(action.patch, undefined, false, icpNames).map((r) => (
            <li key={r.label} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface/60 p-2 text-sm">
              <span className="w-36 text-xs font-semibold text-muted">{r.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />
              <span className="font-semibold text-success">{r.to}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">{action.rationale}</p>
        {needsPipelinePicker && (
          <SelectField label="Pipeline" value={pipelineId} onChange={(e) => onResolve({ status: 'confirmed_create', pipeline_id: e.target.value })}>
            <option value="">Choose pipeline…</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Dismiss</Button>
          <Button
            variant={confirmed ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !pipelineId}
            onClick={() => onResolve({ status: 'confirmed_create', pipeline_id: pipelineId })}
          >
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  // ambiguous
  if (promotedToNew) {
    const confirmedAsNew = resolution.status === 'confirmed_ambiguous_as_new';
    const newPipelineId = resolution.status === 'confirmed_ambiguous_as_new' ? resolution.pipeline_id : (scopedPipelineId ?? '');
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />New lead: {action.mentioned_text}</p>
        <p className="text-xs text-muted">{action.excerpt}</p>
        {needsPipelinePicker && (
          <SelectField label="Pipeline" value={newPipelineId} onChange={(e) => onResolve({ status: 'confirmed_ambiguous_as_new', business_name: action.mentioned_text, pipeline_id: e.target.value })}>
            <option value="">Choose pipeline…</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        )}
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setPromotedToNew(false)}>Back</Button>
          <Button
            variant={confirmedAsNew ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !newPipelineId}
            onClick={() => onResolve({ status: 'confirmed_ambiguous_as_new', business_name: action.mentioned_text, pipeline_id: newPipelineId })}
          >
            {confirmedAsNew ? 'Confirmed ✓' : 'Confirm'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />Not sure who "{action.mentioned_text}" is</p>
      <p className="text-xs text-muted">{action.excerpt}</p>
      <SelectField
        label="Which lead did you mean?"
        value=""
        onChange={(e) => { if (e.target.value) onPickLead(e.target.value); }}
      >
        <option value="">Choose…</option>
        {action.candidate_lead_ids.map((id) => (
          <option key={id} value={id}>{leadsById[id]?.business_name ?? id}</option>
        ))}
      </SelectField>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => onResolve({ status: 'dismissed' })}>Skip</Button>
        <Button variant="ghost" onClick={() => setPromotedToNew(true)}>
          This is someone new
        </Button>
      </div>
    </div>
  );
}
