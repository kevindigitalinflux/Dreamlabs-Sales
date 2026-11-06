import {expect,it} from 'vitest';
import {selectRows} from './rowSelection';
import {runReviewBatch, selectedReviewRows} from './reviewBatch';
const rows=Array.from({length:53},(_,i)=>({id:String(i)}));
it('selects all actionable rows and clears all',()=>{
 const selected=selectRows(new Set(),rows.map(r=>r.id));expect(selected.size).toBe(53);
 expect(selectRows(selected,rows.map(r=>r.id)).size).toBe(0);
});
it('acts only on selected current rows',()=>expect(selectedReviewRows(rows,new Set(['2','5','stale']),r=>r.id)).toEqual([rows[2],rows[5]]));
it('retains per-row failures and continues sequentially',async()=>{
 const seen:string[]=[];const out=await runReviewBatch(rows,new Set(['0','1','2']),r=>r.id,async r=>{seen.push(r.id);if(r.id==='1')throw Error('Try again');return null;});
 expect(seen).toEqual(['0','1','2']);expect(out.map(r=>r.error)).toEqual([null,'Try again',null]);
});
it('caps each batch at fifty while leaving excess selection available',async()=>{
 const out=await runReviewBatch(rows,new Set(rows.map(r=>r.id)),r=>r.id,async()=>null);expect(out).toHaveLength(50);
});
it('does no work with empty selection',async()=>expect(await runReviewBatch(rows,new Set(),r=>r.id,async()=>{throw Error('Must not run');})).toEqual([]));
