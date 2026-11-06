import {expect,it,vi} from 'vitest';
import {lookupReviewReason,saveLookupReview} from './lookupReviewActions';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
import type {Lead} from '../types';
const row={id:'a',lead_id:'lead',status:'done' as const,review:'pending' as const,reason:null,lead:{id:'lead',email:''} as Lead,result:{proposed:{email:'person@example.com'}}};
it('selects only editable completed enrichment proposals',()=>{
 expect(lookupReviewReason(row,'enrich',true)).toBeNull();expect(lookupReviewReason(row,'decision_makers',true)).toContain('people');
 expect(lookupReviewReason(row,'enrich',false)).toContain('permission');expect(selectRows(new Set(),[row.id]).size).toBe(1);
});
it('applies a selected proposal through lead write before review marking',async()=>{
 const seen:string[]=[];
 expect(await saveLookupReview(row,{email:'person@example.com'},[],{read:async()=>row.lead,write:async()=>{seen.push('write');return null;},mark:async()=>{seen.push('mark');return true;},current:()=>true})).toBeNull();
 expect(seen).toEqual(['write','mark']);
});
it('retains partial failure and never marks a refused lead write applied',async()=>{
 const mark=vi.fn(async()=>true);const out=await runReviewBatch([row,{...row,id:'b'}],new Set(['a','b']),r=>r.id,r=>saveLookupReview(r,{email:'person@example.com'},[],{
 read:async()=>r.lead,write:async()=>r.id==='a'?'Denied':null,mark,current:()=>true}));
 expect(out.map(r=>r.error)).toEqual(['Denied',null]);expect(mark).toHaveBeenCalledTimes(1);
});
it('caps lookup result batches at fifty',async()=>{
 const rows=Array.from({length:51},(_,i)=>({...row,id:String(i)}));expect(await runReviewBatch(rows,new Set(rows.map(r=>r.id)),r=>r.id,async()=>null)).toHaveLength(50);
});
it('does not write any unselected lookup result',async()=>{
 const save=vi.fn(async()=>null);await runReviewBatch([row],new Set(),r=>r.id,save);expect(save).not.toHaveBeenCalled();
});
it('does not overwrite a changed lead or continue after its review scope changes',async()=>{
 const write=vi.fn(async()=>null),mark=vi.fn(async()=>true);
 expect(await saveLookupReview(row,{email:'person@example.com'},[],{read:async()=>({...row.lead,email:'changed@example.com'}),write,mark,current:()=>true})).toContain('changed');
 expect(await saveLookupReview(row,{},[],{read:async()=>row.lead,write,mark,current:()=>false})).toContain('available');expect(write).not.toHaveBeenCalled();
});
