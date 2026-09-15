import { useState } from 'react';
import { ArrowRight, Sparkles } from 'lucide-react';
import { formatCurrency, packageLabel, stageInfo } from '../../lib/utils';
import { Button } from '../ui/Button';
import { SelectField } from '../ui/Input';
import type { ActionResolution } from '../../hooks/useDreamAgentSession';
import type { DreamAgentAction, Lead, Pipeline } from '../../types';

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
  onResolve: (resolution: ActionResolution) => void;
}

/** One proposed action from Dream Agent, resolved by the user before it can be
 * confirmed. `update` renders a from/to diff (matching SuggestionDiff's pattern);
 * `create` shows extracted fields + a pipeline picker if needed; `ambiguous` shows
 * a candidate picker plus "this is someone new", which itself becomes a create-like
 * picker step rather than guessing a pipeline. */
export function ActionRow({ action, resolution, leadsById, pipelines, scopedPipelineId, needsPipelinePicker, onResolve }: ActionRowProps) {
  const [promotedToNew, setPromotedToNew] = useState(false);

  if (action.type === 'update') {
    const lead = leadsById[action.lead_id];
    const rows: { label: string; from: string; to: string }[] = [];
    if (action.patch.stage && lead && action.patch.stage !== lead.stage) rows.push({ label: 'Stage', from: stageInfo(lead.stage).label, to: stageInfo(action.patch.stage).label });
    if (action.patch.deal_value !== undefined) rows.push({ label: 'Deal value', from: lead?.deal_value != null ? formatCurrency(lead.deal_value) : '—', to: formatCurrency(action.patch.deal_value) });
    if (action.patch.package_tier) rows.push({ label: 'Package', from: packageLabel(lead?.package_tier ?? null), to: packageLabel(action.patch.package_tier) });
    if (action.patch.next_action_date) rows.push({ label: 'Next action date', from: lead?.next_action_date ?? '—', to: action.patch.next_action_date });
    if (action.patch.next_action_note) rows.push({ label: 'Next action', from: lead?.next_action_note ?? '—', to: action.patch.next_action_note });
    if (action.patch.pain_point) rows.push({ label: 'Pain point (info only)', from: '—', to: action.patch.pain_point });
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
        <p className="text-xs text-muted">{[action.extracted.city, action.extracted.phone, action.extracted.email].filter(Boolean).join(' · ') || 'No extra details found'}</p>
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

  const asLeadSelected = resolution.status === 'confirmed_ambiguous_as_lead' ? resolution.lead_id : '';
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-cyan" aria-hidden />Not sure who "{action.mentioned_text}" is</p>
      <p className="text-xs text-muted">{action.excerpt}</p>
      <SelectField
        label="Which lead did you mean?"
        value={asLeadSelected}
        onChange={(e) => onResolve({ status: 'confirmed_ambiguous_as_lead', lead_id: e.target.value })}
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
