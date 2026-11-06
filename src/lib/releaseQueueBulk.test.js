import {expect,it,vi} from 'vitest';
import {discardReviewDraft,releaseReviewDraft,reviewedDraftMatches} from './draftReviewActions';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
const rows=[{id:'a',to_email:'a@example.com',subject:'Subject',body:'Body',lead:{id:'lead'}},{id:'b',to_email:'b@example.com'}];
it('selects all waiting drafts',()=>expect(selectRows(new Set(),rows.map(r=>r.id)).size).toBe(2));
it('rejects only selected drafts using the same guarded single-row path',async()=>{
 const query={delete:()=>query,eq:()=>query,in:()=>query,select:()=>query,maybeSingle:vi.fn(async()=>({data:{id:'a'},error:null}))};
 const client={from:vi.fn(()=>query)};
 await runReviewBatch(rows,new Set(['a']),r=>r.id,r=>discardReviewDraft(client,r.id));
 expect(query.maybeSingle).toHaveBeenCalledTimes(1);expect(client.from).toHaveBeenCalledWith('email_logs');
});
it('keeps failed release errors per row while continuing',async()=>{
 const client={functions:{invoke:vi.fn().mockResolvedValueOnce({data:{error:'Blocked'},error:null}).mockResolvedValueOnce({data:{ok:true},error:null})}};
 const out=await runReviewBatch(rows,new Set(['a','b']),r=>r.id,async r=>(await releaseReviewDraft(client,r)).error);
 expect(out[0].error).toBe('Blocked');expect(out[1].error).toBeNull();
 expect(client.functions.invoke.mock.calls[0][1].body).toMatchObject({log_id:'a',lead_id:'lead'});
});
it('caps a release batch at fifty',async()=>{
 const many=Array.from({length:51},(_,i)=>({...rows[0],id:String(i)}));const action=vi.fn(async()=>null);
 await runReviewBatch(many,new Set(many.map(r=>r.id)),r=>r.id,action);expect(action).toHaveBeenCalledTimes(50);
});
it('does not release or reject an empty selection',async()=>{
 const action=vi.fn(async()=>null);await runReviewBatch(rows,new Set(),r=>r.id,action);expect(action).not.toHaveBeenCalled();
});
it('reports a draft concurrently sent or removed instead of false rejection success',async()=>{
 const q={delete:()=>q,eq:()=>q,in:()=>q,select:()=>q,maybeSingle:async()=>({data:null,error:null})};
 expect(await discardReviewDraft({from:()=>q},'a')).toContain('changed');
});
it.each(['body','to_email','attachments'])('requires a fresh review when a selected draft changes its %s',field=>{
 const before={...rows[0],attachments:[]};
 const after={...before,[field]:field==='attachments'?[{path:'org/changed',name:'Changed.pdf'}]:'Changed'};
 expect(reviewedDraftMatches(before,before)).toBe(true);expect(reviewedDraftMatches(before,after)).toBe(false);
});
