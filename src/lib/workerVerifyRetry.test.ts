import {afterEach,expect,it,vi} from 'vitest';
import {makeWorkerClient} from '../../supabase/functions/_shared/workerClient';
import {RunVerifyGate} from '../../supabase/functions/_shared/runVerifyGate';
import type {UsageClient} from '../../supabase/functions/_shared/usage';

afterEach(()=>vi.useRealTimers());
function fixture(first:string,hosted=false,budget=130000,second='deliverable') {
 vi.useFakeTimers();vi.setSystemTime(0);
 let state:Record<string,unknown>={},version=0;const starts:number[]=[];const rpcCalls:string[]=[];
 const usage:UsageClient={rpc:async(name)=>{rpcCalls.push(name);return {data:name==='usage_reserve'?{ok:true,day:'2026-11-05',used:1,limit:600,global_used:1,global_limit:1200}:true,error:null};}};
 const gate=new RunVerifyGate({read:async()=>({state:structuredClone(state),version:String(version)}),swap:async(v,next)=>{if(v!==String(version))return false;state=structuredClone(next);version++;return true;}},undefined,undefined,async()=>hosted);
 const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
  starts.push(Date.now());
  if(starts.length===1&&first==='timeout')return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
  const reason=starts.length===1?first:second;
  return new Response(JSON.stringify({email:'p@example.com',status:reason==='deliverable'?'valid':reason==='catch_all'?'risky':'unverifiable',reason}));
 });
 const client=makeWorkerClient({usage,orgId:'org',config:{url:'https://worker.fixture.invalid',secret:'local-placeholder'},fetchImpl:fetcher,verifyGate:gate,verifyTimeLeftMs:()=>budget-Date.now(),retryTransient:()=>!hosted});
 return {client,starts,rpcCalls,gate,state:()=>state};
}
it.each(['unknown','timeout'])('retries non-hosted %s after sixty seconds as one address check',async first=>{
 const f=fixture(first);const result=f.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(100000);
 expect(await result).toMatchObject({ok:true,value:{status:'valid'}});
 expect(f.starts).toEqual([0,first==='timeout'?93000:60000]);
 expect(f.rpcCalls.filter(n=>n==='usage_reserve')).toHaveLength(2);expect(f.rpcCalls.filter(n=>n==='usage_refund')).toHaveLength(0);
 expect(f.client.lines().join(' ')).toContain('Checked 1 email address');
 expect(f.state()['example.com']).toMatchObject({blocked:false,pendingUntil:0});
});
it.each(['catch_all','provider_blocks_checks'])('does not retry %s',async reason=>{
 const f=fixture(reason);const result=f.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(100000);await result;
 expect(f.starts).toEqual([0]);
});
it('does not retry hosted mail or borrow a missing full call window',async()=>{
 const hosted=fixture('unknown',true);const a=hosted.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(100000);await a;expect(hosted.starts).toEqual([0]);
 const short=fixture('unknown',false,60000);const b=short.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(100000);await b;expect(short.starts).toEqual([0]);
});
it('never makes a third attempt, and a full timeout cannot retry inside 120 seconds',async()=>{
 const twice=fixture('unknown',false,130000,'unknown');const a=twice.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(130000);
 expect(await a).toMatchObject({ok:true,value:{status:'unverifiable'}});expect(twice.starts).toEqual([0,60000]);
 const short=fixture('timeout',false,120000);const b=short.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(130000);await b;
 expect(short.starts).toEqual([0]);
});
it('releases an unknown-result lease while waiting so another address can use the domain',async()=>{
 const f=fixture('unknown');const result=f.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(1);
 expect(f.state()['example.com']).toMatchObject({pendingUntil:0,blocked:false});
 const other=vi.fn(async()=>({ok:true as const,value:{status:'valid' as const,reason:'deliverable'}}));
 expect(await f.gate.run('other@example.com',0,other)).toMatchObject({ok:true});expect(other).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(100000);await result;
});
it('does not let a different retry owner clear a timeout breaker',async()=>{
 const f=fixture('timeout');const result=f.client.verifyEmail('p@example.com');await vi.advanceTimersByTimeAsync(33001);
 const other=vi.fn();expect(await f.gate.run('other@example.com',100000,other,{retry:true,retryOwner:'wrong-owner'})).toMatchObject({ok:false,failure:'timeout'});
 expect(other).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(100000);await result;
});
