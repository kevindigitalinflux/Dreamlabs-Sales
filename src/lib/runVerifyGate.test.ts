import { expect, it } from 'vitest';
import { RunVerifyGate, type VerifyGateStore } from '../../supabase/functions/_shared/runVerifyGate';
import { WORKER_TIMEOUT_MS } from '../../supabase/functions/_shared/workerRules';
import { GUESS_CHECK_TIMEOUT_MS, GuessChecks } from '../../supabase/functions/_shared/personEmailFinding';

function fixture() {
 let state: Record<string, unknown> = {}; let version = 0; let now = 0;
 const starts: number[] = [];
 const store: VerifyGateStore = {
  read: async () => ({ state: structuredClone(state), version: String(version) }),
  swap: async (expected, next) => { if (expected !== String(version)) return false; state = structuredClone(next); version++; return true; },
 };
 const gate = () => new RunVerifyGate(store, () => now, async ms => { now += ms; });
 const check = async () => { starts.push(now); return { ok: true as const, value: { status: 'invalid' as const, reason: 'mailbox_missing' as const } }; };
 return { gate, check, starts, store };
}
it('allows 33 seconds for client and guess checks', () => {
 expect(WORKER_TIMEOUT_MS.verify).toBe(33000);
 expect(GUESS_CHECK_TIMEOUT_MS).toBe(33000);
});
it.each(['timeout', 'provider_blocks_checks'])('stops a run/domain after one %s across fresh instances', async reason => {
 const f = fixture(); let calls = 0;
 const first = await f.gate().run('a@example.com', 33000, async () => { calls++; return reason === 'timeout'
  ? { ok: false, failure: 'timeout', line: 'timeout' }
  : { ok: true, value: { status: 'unverifiable', reason: 'provider_blocks_checks' } }; });
 const second = await f.gate().run('b@example.com', 33000, f.check);
 expect(first).toBeDefined(); expect(second.ok).toBe(false); expect(calls).toBe(1); expect(f.starts).toEqual([]);
 expect((await f.gate().run('a@other.com', 33000, f.check)).ok).toBe(true);
});
it('paces a sixth same-domain check beyond a minute without reserving while waiting', async () => {
 const f = fixture();
 for (let i=0;i<6;i++) expect((await f.gate().run(`${i}@example.com`, 120000, f.check)).ok).toBe(true);
 expect(f.starts).toHaveLength(6);
 expect(f.starts[5]! - f.starts[0]!).toBeGreaterThan(60000);
});
it('keeps the worker available when the store fails', async () => {
 let called = false;
 const gate = new RunVerifyGate({ read: async () => { throw new Error('offline'); }, swap: async () => false });
 expect((await gate.run('a@example.com',33000, async () => { called=true; return { ok:false, failure:'timeout', line:'timeout' }; })).ok).toBe(false);
 expect(called).toBe(true);
});
it('blocks GuessChecks after its first timeout without blocking another domain', () => {
 const checks = new GuessChecks(); checks.record('a@example.com', null, 'timeout');
 expect(checks.canCheck('b@example.com')).toBe(false);
 expect(checks.canCheck('b@other.com')).toBe(true);
});

it('keeps an abandoned pending call closed across a new gate instance', async () => {
 const f = fixture();
 await expect(f.gate().run('a@example.com',33000, async () => { throw new Error('worker interrupted'); })).rejects.toThrow('worker interrupted');
 expect(await f.gate().run('b@example.com',0,f.check)).toMatchObject({ok:true,value:{reason:'waiting_for_domain'}});
 expect(f.starts).toEqual([]);
});
it('does not dispatch a shorter check when spacing leaves less than 33 seconds', async () => {
 const f=fixture(); await f.gate().run('a@example.com',33000,f.check);
 expect(await f.gate().run('b@example.com',0,f.check)).toMatchObject({ok:true,value:{reason:'waiting_for_domain'}});
 expect(f.starts).toHaveLength(1);
});

it.each(['read', 'swap', 'invalid'])('runs the worker once when gate infrastructure fails: %s', async failure => {
 let calls=0;
 const store:VerifyGateStore={
  read:async()=>{if(failure==='read')throw new Error('offline');return {state:failure==='invalid'?{'example.com':{nextAt:'bad'}}:{},version:'v'};},
  swap:async()=>false,
 };
 const gate=new RunVerifyGate(store);const result={ok:true as const,value:{status:'invalid' as const,reason:'mailbox_missing' as const}};
 expect(await gate.run('a@example.com',35000,async()=>{calls++;return result;})).toEqual(result);
 expect(calls).toBe(1);
 expect(gate.lines()).toEqual(['Run-wide email check pacing was unavailable; checks ran without it.']);
});
it('returns the worker result without dispatching twice when saving it fails',async()=>{
 let swaps=0;let state:Record<string,unknown>={};let calls=0;
 const gate=new RunVerifyGate({read:async()=>({state,version:'v'}),swap:async(_v,s)=>{if(++swaps>1)throw new Error('save failed');state=s;return true;}},()=>0);
 const result={ok:true as const,value:{status:'valid' as const,reason:'deliverable' as const}};
 expect(await gate.run('a@example.com',35000,async()=>{calls++;return result;})).toEqual(result);
 expect(calls).toBe(1);
});

it.each(['catch_all','provider_blocks_checks','unknown','timeout'])('uses one hosted canary across instances after %s',async reason=>{
 const f=fixture();let calls=0;let detections=0;
 const gate=()=>new RunVerifyGate(f.store,()=>0,async()=>{},async()=>{detections++;return true;});
 await gate().run('a@example.com',35000,async()=>{calls++;return {ok:true,value:{status:reason==='catch_all'?'risky':'unverifiable',reason}};});
 expect(await gate().run('b@example.com',35000,async()=>{calls++;return {ok:true,value:{status:'valid',reason:'deliverable'}};})).toMatchObject({ok:true,value:{reason:'hosted_unverifiable'}});
 expect(calls).toBe(1);expect(detections).toBe(1);
});
it.each(['valid','invalid'] as const)('continues hosted checks after a clear %s canary',async status=>{
 const f=fixture();const gate=new RunVerifyGate(f.store,()=>0,async()=>{},async()=>true);
 expect(await gate.run('a@example.com',35000,async()=>({ok:true,value:{status,reason:'clear'}}))).toMatchObject({ok:true});
 const next=new RunVerifyGate(f.store,()=>12001,async()=>{},async()=>{throw new Error('must reuse provider');});
 expect(await next.run('b@example.com',35000,async()=>({ok:true,value:{status:'invalid',reason:'mailbox_missing'}}))).toMatchObject({ok:true,value:{status:'invalid'}});
});

it('records hosted_unverifiable once in durable state and one note at the canary lead',async()=>{
 const f=fixture();const gate=new RunVerifyGate(f.store,()=>0,async()=>{},async()=>true);
 await gate.run('first@example.com',35000,async()=>({ok:true,value:{status:'unverifiable',reason:'unknown'}}));
 await gate.run('next@example.com',35000,f.check);
 expect(gate.lines().filter(l=>l.includes('hosted mail'))).toHaveLength(1);
 expect((await f.store.read()).state['example.com']).toMatchObject({hostedUnverifiable:true,canaryDone:true});
 const later=new RunVerifyGate(f.store,()=>0,async()=>{},async()=>true);
 await later.run('later@example.com',35000,f.check);
 expect(later.lines()).toEqual([]);expect(f.starts).toEqual([]);
});

it('emits a waiting notice only once per domain across lead instances',async()=>{
 const f=fixture();await f.gate().run('a@example.com',33000,f.check);
 const waiting=f.gate();await waiting.run('b@example.com',0,f.check);
 const later=f.gate();await later.run('c@example.com',0,f.check);
 expect(waiting.lines().filter(l=>l.includes('waiting for its next check'))).toHaveLength(1);
 expect(later.lines()).toEqual([]);expect(f.starts).toHaveLength(1);
});

it('persists domain-note suppression independently of the worker verdict',async()=>{
 const f=fixture();
 await f.gate().run('a@example.com',35000,async()=>({ok:true,value:{status:'unverifiable',reason:'unknown'}}));
 const later=new RunVerifyGate(f.store,()=>12001,async()=>{});
 expect(await later.run('b@example.com',35000,async()=>({ok:true,value:{status:'unverifiable',reason:'unknown'}}))).toMatchObject({ok:true,value:{reason:'unknown'},domainNoteSuppressed:true});
});
