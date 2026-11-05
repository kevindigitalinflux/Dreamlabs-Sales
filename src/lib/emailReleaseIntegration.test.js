import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/smtp',()=>({sendMail:vi.fn(async()=>({messageId:'<sent@example.com>'}))}));
vi.mock('../../supabase/functions/_shared/emailPreSend',async original=>({...await original(),checkEmailBeforeSend:vi.fn()}));
import {makeEmailPrechecker,checkEmailBeforeSend} from '../../supabase/functions/_shared/emailPreSend';
import {sendLeadEmail} from '../../supabase/functions/_shared/sendLeadEmail';
import {makeWorkerClient} from '../../supabase/functions/_shared/workerClient';
import {RunVerifyGate} from '../../supabase/functions/_shared/runVerifyGate';
import {emailReleaseSummary} from './emailVerification';
import {replyDatabase} from './replyTestDatabase';

afterEach(()=>vi.useRealTimers());
it.each([false,true])('checks 120 release recipients with bounded transient retry=%s and reports actual confirmation',async retry=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
 const db=replyDatabase({email_outcomes:[]});const events=[];let reserves=0,refunds=0;
 db.service.rpc=vi.fn(async(name,args)=>{
  if(name==='usage_reserve'){reserves++;events.push('reserve');return {data:{ok:true,day:'2026-11-05',used:reserves,limit:600,global_used:reserves,global_limit:1200},error:null};}
  if(name==='usage_refund'){refunds++;return {data:true,error:null};}
  if(name==='record_email_outcome'){db.tables.email_outcomes.push({org_id:args.p_org_id,address:args.p_address,outcome:args.p_outcome,seen_at:args.p_seen_at});return {error:null};}
  throw new Error('Unexpected test RPC');
 });
 let state={},version=0;
 const gate=new RunVerifyGate({read:async()=>({state:structuredClone(state),version:String(version)}),swap:async(v,s)=>{if(v!==String(version))return false;state=structuredClone(s);version++;return true;}});
 const attempts=new Map();
 const fetcher=vi.fn(async(_url,init)=>{
  events.push('fetch');const {email}=JSON.parse(init.body);const i=Number(email.match(/^person(\d+)/)[1]);
  const attempt=(attempts.get(email)??0)+1;attempts.set(email,attempt);
  await new Promise(resolve=>setTimeout(resolve,1000));
  if(i%4===3)return new Response('{}',{status:503});
  const valid=i%4===1||(i%4===2&&attempt>1);
  return new Response(JSON.stringify({email,status:i%4===0?'invalid':valid?'valid':'unverifiable',reason:i%4===0?'mailbox_missing':valid?'deliverable':'unknown'}));
 });
 const check=makeEmailPrechecker(db.service,'org',{lookupMx:async()=>'mx',workerFactory:()=>makeWorkerClient({usage:db.service,orgId:'org',config:{url:'https://worker.fixture.invalid',secret:'local-placeholder'},fetchImpl:fetcher,verifyGate:gate,verifyTimeLeftMs:()=>110000,retryTransient:()=>retry})});
 checkEmailBeforeSend.mockImplementation((_service,input)=>check(input));
 const results=[];
 for(let i=0;i<120;i++) {
  const pending=sendLeadEmail(db.service,{senderId:'sender',leadId:'lead',orgId:'org',leadStage:'contacted',mailbox:{settings:{},pass:'local-placeholder'},to:`person${i}@company${Math.floor(i/2)}.example.com`,subject:'Reviewed fixture',body:'Fixture only'});
  await vi.advanceTimersByTimeAsync(100000);const result=await pending;
  results.push({ok:result.ok,blocked:!result.ok&&result.verification?.status==='invalid',verification:result.verification});
 }
 expect(fetcher).toHaveBeenCalledTimes(retry?150:120);expect(reserves).toBe(retry?150:120);expect(refunds).toBe(30);
 expect(events.slice(0,2)).toEqual(['reserve','fetch']);
 expect(emailReleaseSummary(results)).toBe(`Sent 90; blocked 30; not confirmed ${retry?30:60}; failed 0`);
 expect(db.tables.email_logs).toHaveLength(90);
 expect(db.tables.email_outcomes.filter(r=>r.outcome==='checked_valid')).toHaveLength(retry?60:30);
 expect(db.tables.email_outcomes.filter(r=>r.outcome==='checked_unverifiable')).toHaveLength(retry?0:30);
 expect(db.tables.email_logs.filter(log=>!db.tables.email_outcomes.some(row=>row.address===log.to_email))).toHaveLength(30);
});
