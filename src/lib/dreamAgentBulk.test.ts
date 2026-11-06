import {expect,it,vi} from 'vitest';
import {confirmAgentRow} from './dreamAgentBulk';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ActionRow} from '../components/dreamAgent/ActionRow';
it('selects all ready rows without selecting blocked action rows',()=>expect([...selectRows(new Set(),['ready'])]).toEqual(['ready']));
it('confirms only explicitly selected rows through their own edited confirmation callback',async()=>{
 const resolve=vi.fn();const rows=[{id:'a',confirm:()=>resolve({status:'confirmed_update_company_context',edited_context:'Edited context'}),problem:null},{id:'b',confirm:()=>resolve({status:'confirmed_update'}),problem:null}];
 await runReviewBatch(rows,new Set(['a']),r=>r.id,confirmAgentRow);expect(resolve).toHaveBeenCalledExactlyOnceWith({status:'confirmed_update_company_context',edited_context:'Edited context'});
});
it('retains blocked confirmations as failures while other rows succeed',async()=>{
 const resolve=vi.fn();const out=await runReviewBatch([{id:'a',problem:'Choose a pipeline',confirm:resolve},{id:'b',problem:null,confirm:resolve}],new Set(['a','b']),r=>r.id,confirmAgentRow);
 expect(out.map(r=>r.error)).toEqual(['Choose a pipeline',null]);expect(resolve).toHaveBeenCalledTimes(1);
});
it('caps confirmations at fifty',async()=>{
 const resolve=vi.fn();const rows=Array.from({length:51},(_,i)=>({id:String(i),problem:null,confirm:resolve}));
 await runReviewBatch(rows,new Set(rows.map(r=>r.id)),r=>r.id,confirmAgentRow);expect(resolve).toHaveBeenCalledTimes(50);
});
it('does not resolve or write anything for an empty selection',async()=>{
 const resolve=vi.fn();await runReviewBatch([{id:'a',problem:null,confirm:resolve}],new Set(),r=>r.id,confirmAgentRow);expect(resolve).not.toHaveBeenCalled();
});
it('keeps the row diff and explicit confirm text, with no admin confirmation for a rep',()=>{
 const props={resolution:{status:'pending'} as const,leadsById:{},pipelines:[],scopedPipelineId:null,needsPipelinePicker:true,isOrgAdmin:false,onResolve:()=>{},onPickLead:()=>{}};
 const update=renderToStaticMarkup(createElement(ActionRow,{...props,action:{type:'update',lead_id:'a',business_name:'Example',patch:{next_action_note:'Call on Monday'},rationale:'User instruction',excerpt:'Call'}}));
 expect(update).toContain('Call on Monday');expect(update).toContain('Confirm');
 const admin=renderToStaticMarkup(createElement(ActionRow,{...props,action:{type:'update_company_context',proposed_context:'Context',rationale:'User instruction',excerpt:'Context'}}));
 expect(admin).toContain('Only an org admin');expect(admin).not.toContain('>Confirm<');
});
