import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({slots:[],cursor:0}));
vi.mock('react',()=>({
 useState(initial){const i=state.cursor++;if(!(i in state.slots))state.slots[i]=typeof initial==='function'?initial():initial;
  return [state.slots[i],value=>{state.slots[i]=typeof value==='function'?value(state.slots[i]):value;}];},
 useRef(initial){const i=state.cursor++;return state.slots[i]??(state.slots[i]={current:initial});},
}));
import {useReviewBatch} from '../hooks/useReviewBatch';
const render=ids=>{state.cursor=0;return useReviewBatch(ids);};
beforeEach(()=>{state.slots=[];state.cursor=0;});
it('starts empty, selects all actionable rows, and retains failed and capped rows for retry',async()=>{
 const ids=Array.from({length:52},(_,i)=>String(i));let review=render(ids);
 expect(review.selected.size).toBe(0);review.all();review=render(ids);expect(review.selected.size).toBe(52);
 await review.run(ids,id=>id,async id=>id==='1'?'Denied':null,'Apply');review=render(ids);
 expect([...review.selected]).toEqual(['1','50','51']);expect(review.errors).toEqual({'1':'Denied'});expect(review.done.size).toBe(49);
 await review.run(ids,id=>id,async()=>null,'Retry');review=render(ids);expect(review.selected.size).toBe(0);expect(review.errors).toEqual({});
});
it('blocks empty actions and overlapping batches',async()=>{
 const action=vi.fn(async()=>null);let review=render(['a']);await review.run(['a'],id=>id,action,'Apply');expect(action).not.toHaveBeenCalled();
 review.toggle('a');review=render(['a']);let release;const blocked=new Promise(resolve=>{release=resolve;});
 const first=review.run(['a'],id=>id,async()=>{await blocked;return null;},'Apply');
 await review.run(['a'],id=>id,action,'Apply');expect(action).not.toHaveBeenCalled();release();await first;
});
it('discards stale keys and resets between review runs',()=>{
 let review=render(['a','b']);review.toggle('a');review=render(['a','b']);expect([...review.selected]).toEqual(['a']);
 review=render(['b']);expect(review.selected.size).toBe(0);review.reset();review=render(['a']);expect(review.selected.size).toBe(0);
});
