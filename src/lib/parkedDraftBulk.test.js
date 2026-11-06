import {expect,it,vi} from 'vitest';
import {parkedDraftEligible,actOnParkedDraft} from './parkedDraftActions';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
const row={id:'row',lead_id:'lead',email_log_id:'draft',resolution:'open',status:'needs_input',sequence_id:null};
const log={id:'draft',lead_id:'lead',org_id:'org',sent_by:'sender',status:'draft',to_email:'person@example.com',subject:'Subject',body:'Review this body'};
it('selects only open parked drafts owned by the run sender',()=>{
 expect(parkedDraftEligible(row,log,'sender','org')).toBe(true);
 expect(parkedDraftEligible(row,log,'other','org')).toBe(false);
 expect(parkedDraftEligible({...row,resolution:'checking'},log,'sender','org')).toBe(false);
 expect(selectRows(new Set(),[row.id]).size).toBe(1);
});
it('releases a selected parked draft and runs the shared follow-up only after send succeeds',async()=>{
 const release=vi.fn(async()=>({error:null}));const finish=vi.fn(async()=>({error:null,sent:true}));
 expect(await actOnParkedDraft(row,log,'release',release,async()=>null,finish)).toBeNull();expect(release).toHaveBeenCalledTimes(1);expect(finish).toHaveBeenCalledTimes(1);
});
it('keeps failed sends selected without advancing sequences, and continues other rows',async()=>{
 const finish=vi.fn(async()=>({error:null,sent:true}));
 const out=await runReviewBatch([row,{...row,id:'other'}],new Set(['row','other']),r=>r.id,r=>actOnParkedDraft(r,log,'release',async()=>({error:r.id==='row'?'Blocked':null}),async()=>null,finish));
 expect(out.map(r=>r.error)).toEqual(['Blocked',null]);expect(finish).toHaveBeenCalledTimes(1);
});
it('caps parked operations at fifty',async()=>{
 const rows=Array.from({length:51},(_,i)=>({...row,id:String(i)}));expect(await runReviewBatch(rows,new Set(rows.map(r=>r.id)),r=>r.id,async()=>null)).toHaveLength(50);
});
it('does not send an empty selection and shares the single discard callback',async()=>{
 const discard=vi.fn(async()=>null);await runReviewBatch([row],new Set(),r=>r.id,async()=>{throw Error('Unexpected send');});
 await actOnParkedDraft(row,log,'discard',async()=>{throw Error('Unexpected send');},discard,async()=>{throw Error('Unexpected follow-up');});expect(discard).toHaveBeenCalledWith('draft');
});
