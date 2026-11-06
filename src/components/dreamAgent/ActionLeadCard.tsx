import {ArrowRight,Sparkles} from 'lucide-react';
import {Button} from '../ui/Button';
import {SelectField} from '../ui/Input';
import {ConfirmActionButton} from './ConfirmActionButton';
import {patchRows} from './actionPatchRows';
import type {ActionRowProps} from './ActionRowTypes';
export function ActionLeadCard({action,resolution,leadsById,scopedPipelineId,needsPipelinePicker,pipelines,onResolve,onBulkReady,icpNames={}}:ActionRowProps) {
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
          <ConfirmActionButton onReady={onBulkReady} variant={confirmed ? 'secondary' : 'primary'} onClick={() => onResolve({ status: 'confirmed_update' })}>
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </ConfirmActionButton>
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
          <ConfirmActionButton onReady={onBulkReady}
            variant={confirmed ? 'secondary' : 'primary'}
            disabled={needsPipelinePicker && !pipelineId}
            onClick={() => onResolve({ status: 'confirmed_create', pipeline_id: pipelineId })}
          >
            {confirmed ? 'Confirmed ✓' : 'Confirm'}
          </ConfirmActionButton>
        </div>
      </div>
    );
  }

return null;
}
