import {useCallback,useRef,useState} from 'react';
import {useReviewBatch} from '../../hooks/useReviewBatch';
import {confirmAgentRow,type AgentConfirmHandle} from '../../lib/dreamAgentBulk';
import type {ActionResolution} from '../../hooks/useDreamAgentSession';
import type {DreamAgentAction} from '../../types';
import type {ActionRowProps} from './ActionRowTypes';
import {ActionRow} from './ActionRow';
import {ReviewBatchControls} from '../ui/ReviewBatchControls';
type Common=Omit<ActionRowProps,'action'|'resolution'|'onResolve'|'onPickLead'|'onBulkReady'>;
/** Confirm only stages the row's own resolution; the existing Apply confirmed changes action writes it. */
export function AgentActionReview({actions,resolutions,onResolve,onPickLead,rowProps,busy,applyErrors={}}:{
 actions:DreamAgentAction[];resolutions:Record<number,ActionResolution>;onResolve:(index:number,resolution:ActionResolution)=>void;
 onPickLead:(index:number,id:string)=>void;rowProps:Common;busy:boolean;
 applyErrors?:Record<number,string>;
}) {
 const handles=useRef<Record<string,AgentConfirmHandle>>({});
 const [reasons,setReasons]=useState<Record<string,string|null>>({});
 const onHandle=useCallback((id:string,handle:AgentConfirmHandle|null)=>{
  if(handle)handles.current[id]=handle;else delete handles.current[id];
  const reason=handle?.problem??(handle?null:'Finish reviewing this row using its controls.');
  setReasons(previous=>previous[id]===reason?previous:{...previous,[id]:reason});
 },[]);
 const rows=actions.map((action,index)=>({id:String(index),index,action}));
 const ids=rows.filter(r=>((resolutions[r.index]?.status??'pending')==='pending'||!!applyErrors[r.index])&&reasons[r.id]===null).map(r=>r.id);
 const review=useReviewBatch(ids,Object.keys(applyErrors));
 async function act(action:'confirm'|'skip') {
  if(busy||!window.confirm(action==='confirm'?'Confirm the selected rows using their displayed values? Apply confirmed changes will save them.':'Skip the selected proposed changes?'))return;
  await review.run(rows,r=>r.id,async row=>{
   if(action==='skip'){onResolve(row.index,{status:'dismissed'});return null;}
   return confirmAgentRow(handles.current[row.id]);
  },action==='confirm'?'Confirm':'Skip');
 }
 return <div className="flex min-w-0 flex-col gap-3">
  <ReviewBatchControls review={{...review,busy:busy||review.busy}} ids={ids.filter(id=>!review.done.has(id))} approveLabel="Confirm selected" rejectLabel="Skip selected" onApprove={()=>void act('confirm')} onReject={()=>void act('skip')} />
  {rows.map(row=><SelectableAgentRow key={row.id} {...row} rowProps={rowProps} resolution={resolutions[row.index]??{status:'pending'}}
   selected={review.selected.has(row.id)} disabled={!ids.includes(row.id)||busy||review.busy} hidden={review.done.has(row.id)}
   reason={reasons[row.id]??'Finish reviewing this row using its controls.'} error={review.errors[row.id]??applyErrors[row.index]} busy={busy||review.busy}
   onHandle={onHandle} onToggle={()=>review.toggle(row.id)} onResolve={resolution=>onResolve(row.index,resolution)} onPickLead={id=>onPickLead(row.index,id)} />)}
 </div>;
}
function SelectableAgentRow({id,action,resolution,rowProps,onHandle,onToggle,onResolve,onPickLead,selected,disabled,hidden,reason,error,busy}:{
 id:string;index:number;action:DreamAgentAction;resolution:ActionResolution;rowProps:Common;
 onHandle:(id:string,handle:AgentConfirmHandle|null)=>void;onToggle:()=>void;onResolve:(resolution:ActionResolution)=>void;onPickLead:(id:string)=>void;
 selected:boolean;disabled:boolean;hidden:boolean;reason:string;error?:string;busy:boolean;
}) {
 const ready=useCallback((handle:AgentConfirmHandle|null)=>onHandle(id,handle),[id,onHandle]);
 return <div hidden={hidden} className="min-w-0">
  <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" aria-label={`Select proposed action ${Number(id)+1}`} checked={selected} disabled={disabled} onChange={onToggle} />Select this proposed action</label>
  {disabled&&resolution.status==='pending'&&<p className="text-xs text-muted">{reason}</p>}
  <fieldset disabled={busy}><ActionRow {...rowProps} action={action} resolution={resolution} onResolve={onResolve} onPickLead={onPickLead} onBulkReady={ready} /></fieldset>
  {error&&<p role="alert" className="text-sm text-danger">{error}</p>}
 </div>;
}
