import {useState} from 'react';
import {Sparkles} from 'lucide-react';
import {Button} from '../ui/Button';
import {SelectField} from '../ui/Input';
import {ConfirmActionButton} from './ConfirmActionButton';
import type {ActionRowProps} from './ActionRowTypes';
export function ActionAmbiguousCard({action,resolution,leadsById,pipelines,scopedPipelineId,needsPipelinePicker,onResolve,onPickLead,onBulkReady}:ActionRowProps) {
 const [promotedToNew,setPromotedToNew]=useState(false);
 if(action.type!=='ambiguous')return null;
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
          <ConfirmActionButton onReady={onBulkReady}
            variant={confirmedAsNew ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !newPipelineId}
            onClick={() => onResolve({ status: 'confirmed_ambiguous_as_new', business_name: action.mentioned_text, pipeline_id: newPipelineId })}
          >
            {confirmedAsNew ? 'Confirmed ✓' : 'Confirm'}
          </ConfirmActionButton>
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

