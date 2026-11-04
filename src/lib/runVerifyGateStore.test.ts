import { expect, it } from 'vitest';
import { makeRunVerifyGate, saveRunResult } from '../../supabase/functions/_shared/runVerifyGateStore';
import type { SupabaseClient } from '@supabase/supabase-js';

function database() {
 const row = { id: 'anchor', run_id: 'run', org_id: 'org', status: 'running', domains: { effort: 'low' } as Record<string, unknown> };
 let conflicts=0;
 const scopes: [string, unknown][]=[];
 const service = { from: (table: string) => {
  expect(table).toBe('deep_find_leads');
  let patch: Record<string, unknown> | null=null; const filters: [string,unknown][]=[];
  const matches=()=>filters.every(([k,v])=>k==='domains'?JSON.stringify(row.domains)===v:row[k as keyof typeof row]===v);
  const result=()=>{
   if(patch && conflicts-->0) { row.domains={...row.domains, _verify_gate:{'other.com':{nextAt:0,pendingUntil:0,blocked:true}}}; return {data:[],error:null}; }
   if(!matches())return {data:[],error:null};
   if(patch)Object.assign(row,patch);
   return {data:[structuredClone(row)],error:null};
  };
  const q={select:()=>q,order:()=>q,limit:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);scopes.push([k,v]);return q;},
   update:(p:Record<string,unknown>)=>{patch=p;return q;},maybeSingle:async()=>({data:matches()?structuredClone(row):null,error:null}),
   then:(resolve:(v:unknown)=>unknown)=>resolve(result())}; return q;
 }} as unknown as SupabaseClient;
 return {service,row,scopes,conflict:()=>{conflicts=1;}};
}
it('persists a breaker across real storage adapters and scopes all operations to the run/org', async()=>{
 const f=database();let calls=0;
 await makeRunVerifyGate(f.service,'org','run').run('a@example.com',35000,async()=>{calls++;return {ok:false,failure:'timeout',line:'timeout'};});
 const out=await makeRunVerifyGate(f.service,'org','run').run('b@example.com',35000,async()=>{calls++;return {ok:false,failure:'timeout',line:'timeout'};});
 expect(calls).toBe(1);expect(out.ok).toBe(false);
 expect(f.row.domains.effort).toBe('low');
 expect(f.scopes).toContainEqual(['org_id','org']);expect(f.scopes).toContainEqual(['run_id','run']);
});
it('retries a result write after CAS conflict and preserves the concurrent checker state',async()=>{
 const f=database(); f.conflict();
 await saveRunResult(f.service,'anchor',{status:'done',domains:{steps:['finished']}});
 expect(f.row.status).toBe('done');expect(f.row.domains.steps).toEqual(['finished']);
 expect(f.row.domains._verify_gate).toEqual({'other.com':{nextAt:0,pendingUntil:0,blocked:true}});
});
it('does not overwrite a cancelled or otherwise finished row',async()=>{
 const f=database();f.row.status='skipped';
 await saveRunResult(f.service,'anchor',{status:'done',domains:{steps:[]}});
 expect(f.row.status).toBe('skipped');
});
