import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp',()=>({sendMail:vi.fn()}));
import {claimOne,recoverEndedRunRows} from '../../supabase/functions/_shared/selectedAutopilot';

// A deterministic locked-row double checks orchestration order, not PostgreSQL execution.
function lockedDatabase() {
 let tail=Promise.resolve(); const state={status:'active',working:false,reserved:0};
 const lock=job=>{const result=tail.then(job);tail=result.then(()=>{});return result;};
 return {state,pause:()=>lock(()=>{state.status='paused';}),rpc:(name)=>lock(()=>{
  if(name==='autopilot_claim_lead') {
   if(state.status!=='active'||state.working)return {data:[],error:null};
   state.working=true;return {data:[{id:'row',run_id:'run',lead_id:'lead'}],error:null};
  }
  if(name==='autopilot_reserve_send') {
   const allowed=state.status==='active';if(allowed)state.reserved++;return {data:allowed,error:null};
  }
  throw Error('unexpected RPC');
 })};
}
it('pause queued before concurrent claims denies both claims',async()=>{
 const db=lockedDatabase();const pause=db.pause();const results=await Promise.all([claimOne(db,'run'),claimOne(db,'run'),pause]);
 expect(results.slice(0,2)).toEqual([null,null]);
});
it('a winning claim blocks a second worker and a stale reserve after pause',async()=>{
 const db=lockedDatabase();expect(await claimOne(db,'run')).not.toBeNull();
 await db.pause();expect(await claimOne(db,'run')).toBeNull();
 expect((await db.rpc('autopilot_reserve_send')).data).toBe(false);expect(db.state.reserved).toBe(0);
});
it('one reservation before pause can complete; no reservation after it succeeds',async()=>{
 const db=lockedDatabase();await claimOne(db,'run');
 const reservation=db.rpc('autopilot_reserve_send');const pause=db.pause();
 expect((await reservation).data).toBe(true);await pause;
 expect((await db.rpc('autopilot_reserve_send')).data).toBe(false);
 expect(db.state.reserved).toBe(1);expect(await claimOne(db,'run')).toBeNull();
});
it('concurrent ticks admit only one working row',async()=>{
 const db=lockedDatabase();const rows=await Promise.all([claimOne(db,'run'),claimOne(db,'run')]);
 expect(rows.filter(Boolean)).toHaveLength(1);
});
it('recovery leaves paused and user-stopped queues intact, but closes terminal queues',async()=>{
 const writes=[];const rows=[['paused',null],['cancelled','stopped by user'],['cancelled','failure'],['completed',null]].map(([status,cancel_reason],i)=>({id:String(i),status:'queued',autopilot_runs:{status,cancel_reason}}));
 const db={from(){let patch,id;const q={select:()=>q,in:()=>q,neq:()=>q,eq:(_k,v)=>{id=v;return q;},update:p=>{patch=p;return q;},then:resolve=>{if(patch)writes.push({id,patch});return resolve({data:patch?[]:rows,error:null});}};return q;}};
 await recoverEndedRunRows(db);
 expect(writes.map(w=>w.id)).toEqual(['2','3']);expect(writes.every(w=>w.patch.status==='not_reached')).toBe(true);
});
