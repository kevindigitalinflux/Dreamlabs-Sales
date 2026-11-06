import {expect,it,vi} from 'vitest';
import {runReviewBatch} from './reviewBatch';
import {selectRows} from './rowSelection';
import {restoreDismissedContact} from './restoreDismissed';
import {restoreSelectedPerson} from './dismissedPeopleBulk';
const rows=[{id:'a',name:'Example A',role:null,source:'website'},{id:'b',name:'Example B',role:null,source:'website'}];
it('selects all dismissed people and only current rows',()=>expect([...selectRows(new Set(['stale']),rows.map(r=>r.id))]).toEqual(['a','b']));
it('uses the same compare-and-set restore path for a selected person',async()=>{
 const q={update:vi.fn(()=>q),eq:()=>q,not:()=>q,select:()=>q,maybeSingle:async()=>({data:{id:'a'},error:null})};
 expect(await restoreSelectedPerson({from:()=>q} as never,rows[0])).toBeNull();expect(q.update).toHaveBeenCalledWith({dismissed_at:null});
 expect((await restoreDismissedContact({from:()=>q} as never,'a','Example A')).message).toBe('Restored Example A');
});
it('preserves per-person failures and continues restoring',async()=>{
 const out=await runReviewBatch(rows,new Set(['a','b']),r=>r.id,async row=>row.id==='a'?'Changed since':null);expect(out.map(r=>r.error)).toEqual(['Changed since',null]);
});
it('caps restore batches at fifty',async()=>{
 const many=Array.from({length:51},(_,i)=>({...rows[0],id:String(i)}));expect(await runReviewBatch(many,new Set(many.map(r=>r.id)),r=>r.id,async()=>null)).toHaveLength(50);
});
it('never restores an unselected row',async()=>{
 const action=vi.fn(async()=>null);await runReviewBatch(rows,new Set(),r=>r.id,action);expect(action).not.toHaveBeenCalled();
});
