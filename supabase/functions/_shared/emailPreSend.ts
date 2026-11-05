import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {makeEmailOutcomeLookup} from './emailOutcomeLookup.ts';
import {recordEmailOutcome} from './emailOutcomeLearning.ts';
import {makeWorkerClient,type WorkerClient} from './workerClient.ts';
import {resolveOrgWorkerConfig} from './orgApiKeys.ts';
import {RunVerifyGate} from './runVerifyGate.ts';
import {cachedMailProvider} from './dnsLookup.ts';

export interface EmailPrecheckResult {status:'valid'|'invalid'|'unverifiable';label:string;hardBounce?:boolean;warning?:string}
interface Input {leadId?:string;address:string;timeLeftMs?:()=>number}
const gates=new Map<string,{gate:RunVerifyGate;usedAt:number}>();
/** Warm-isolate coordination only; independent isolates remain bounded by the worker's own domain limiter. */
function sendGate(orgId:string):RunVerifyGate {
  const old=gates.get(orgId);
  if(old&&Date.now()-old.usedAt<120000){old.usedAt=Date.now();return old.gate;}
  let state:Record<string,unknown>={};let version=0;
  const gate=new RunVerifyGate({read:async()=>({state:structuredClone(state),version:String(version)}),swap:async(v,next)=>{
    if(v!==String(version))return false;state=structuredClone(next);version++;return true;
  }},undefined,undefined,async domain=>['google','microsoft','hosted'].includes(cachedMailProvider(domain)??'unknown'));
  if(gates.size>=128)gates.delete(gates.keys().next().value!);
  gates.set(orgId,{gate,usedAt:Date.now()});return gate;
}
const verdict=(status:EmailPrecheckResult['status']):EmailPrecheckResult=>({status,label:status==='invalid'?'Our checker says this address does not exist':status==='valid'?'Confirmed':'Not confirmed'});

/** One operation's small address cache plus the org-scoped fourteen-day durable cache proposed in Part A SQL. */
export function makeEmailPrechecker(service:SupabaseClient,orgId:string,deps:{worker?:WorkerClient;now?:()=>number}={}) {
  const now=deps.now??Date.now;
  const cache=new Map<string,{at:number;result:EmailPrecheckResult}>();
  return async(input:Input):Promise<EmailPrecheckResult>=>{
    const email=input.address.trim().toLowerCase();
    // Always refresh hard-bounce evidence, including before a cached valid result is reused.
    const history=makeEmailOutcomeLookup(service,orgId);
    const known=await history.status(email);
    if(known)return known.status==='invalid'?{status:'invalid',label:'This address bounced before.',hardBounce:true}:{status:'valid',label:'This address has replied before.'};
    const recent=await history.recentCheck(email,now());
    if(recent)return verdict(recent.outcome==='checked_valid'?'valid':recent.outcome==='checked_invalid'?'invalid':'unverifiable');
    const remembered=cache.get(email);
    if(remembered&&remembered.at>=now()-14*86400000)return remembered.result;
    const deadline=Date.now()+110000;
    let checked:Awaited<ReturnType<WorkerClient['verifyEmail']>>;
    try {
      const worker=deps.worker??makeWorkerClient({usage:service,orgId,
        config:await resolveOrgWorkerConfig(service,orgId,Deno.env.get('WORKER_SHARED_ORG_IDS')),
        verifyGate:sendGate(orgId),verifyTimeLeftMs:()=>Math.max(0,Math.min(deadline-Date.now(),input.timeLeftMs?.()??Infinity))});
      checked=await worker.verifyEmail(email,{timeoutMs:33000});
    }catch{console.error('email precheck: checker unavailable');return verdict('unverifiable');}
    if(!checked.ok)return verdict('unverifiable');
    const result=verdict(checked.value.status==='valid'?'valid':checked.value.status==='invalid'?'invalid':'unverifiable');
    if(['waiting_for_domain','lead_time_exhausted'].includes(checked.value.reason))return result;
    if(input.leadId) {
      try{await recordEmailOutcome(service,{orgId,leadId:input.leadId,address:email,outcome:`checked_${result.status}`,source:`check:${crypto.randomUUID()}`,seenAt:new Date(now())});}
      catch{console.error('email precheck: result cache unavailable');result.warning='The email check result could not be saved.';}
    }
    if(cache.size>=256)cache.delete(cache.keys().next().value!);
    cache.set(email,{at:now(),result});return result;
  };
}
/** Shared boundary used by every real send path; it never sends a message itself. */
export async function checkEmailBeforeSend(service:SupabaseClient,input:Input&{orgId:string}):Promise<EmailPrecheckResult> {
  return makeEmailPrechecker(service,input.orgId)(input);
}
