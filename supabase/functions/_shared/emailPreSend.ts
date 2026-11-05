import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {makeEmailOutcomeLookup} from './emailOutcomeLookup.ts';
import {recordEmailOutcome} from './emailOutcomeLearning.ts';
import {makeWorkerClient,type WorkerClient} from './workerClient.ts';
import {resolveOrgWorkerConfig} from './orgApiKeys.ts';
import {RunVerifyGate} from './runVerifyGate.ts';
import {cachedMailProvider,lookupMx} from './dnsLookup.ts';
import {emailSyntaxValid,emailDomainTypo,isRoleAddress,roleAddressNeedsReview,ROLE_ADDRESS_LABEL} from './emailPrecheckRules.ts';

export interface EmailPrecheckResult {status:'valid'|'invalid'|'unverifiable';label:string;hardBounce?:boolean;warning?:string;overridden?:boolean;overridable?:boolean}
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
export function makeEmailPrechecker(service:SupabaseClient,orgId:string,deps:{worker?:WorkerClient;workerFactory?:()=>WorkerClient;now?:()=>number;lookupMx?:(domain:string)=>Promise<'mx'|'none'|'error'>}={}) {
  const now=deps.now??Date.now;
  const cache=new Map<string,{at:number;result:EmailPrecheckResult}>();
  const remember=async(input:Input,email:string,result:EmailPrecheckResult)=>{
    if(input.leadId) {
      try{await recordEmailOutcome(service,{orgId,leadId:input.leadId,address:email,outcome:`checked_${result.status}`,source:`check:${crypto.randomUUID()}`,seenAt:new Date(now())});}
      catch{console.error('email precheck: result cache unavailable');result.warning='The email check result could not be saved.';}
    }
    if(cache.size>=256)cache.delete(cache.keys().next().value!);
    cache.set(email,{at:now(),result});return result;
  };
  return async(input:Input):Promise<EmailPrecheckResult>=>{
    const email=input.address.trim().toLowerCase();
    if(!emailSyntaxValid(email))return {status:'invalid',label:'This email address has invalid syntax',overridable:false};
    const domain=email.split('@')[1]!;
    const typo=emailDomainTypo(email);
    const roleVerdict=(value:EmailPrecheckResult):EmailPrecheckResult=>value.label!=='This address has replied before.'&&!value.label.startsWith('Not checked:')&&value.status!=='invalid'
      &&(roleAddressNeedsReview(email,cachedMailProvider(domain)??'unknown',false)||(isRoleAddress(email)&&value.label==='Not confirmed'))
      ?{...value,status:'unverifiable',label:ROLE_ADDRESS_LABEL}:value;
    const disclose=(raw:EmailPrecheckResult):EmailPrecheckResult=>{const value=roleVerdict(raw);return typo?{...value,label:`${value.label}. Possible domain typo: did you mean ${typo}? Address was not changed.`}:value;};
    // Always refresh hard-bounce evidence, including before a cached valid result is reused.
    const history=makeEmailOutcomeLookup(service,orgId);
    const known=await history.status(email);
    if(known)return disclose(known.status==='invalid'?{status:'invalid',label:'This address bounced before.',hardBounce:true}:{status:'valid',label:'This address has replied before.'});
    const mxLookup=deps.lookupMx??((d:string)=>lookupMx(d,3000,true));
    const roleMx=isRoleAddress(email)?await mxLookup(domain):undefined;
    if(roleMx==='none')return disclose(await remember(input,email,{status:'invalid',label:'This email domain has no mail server'}));
    const recent=await history.recentCheck(email,now());
    if(recent){const base=verdict(recent.outcome==='checked_valid'?'valid':recent.outcome==='checked_invalid'?'invalid':'unverifiable');const policy=roleVerdict(base);
      if(policy.status!==base.status)await remember(input,email,policy);return disclose(policy);}
    const remembered=cache.get(email);
    if(remembered&&remembered.at>=now()-14*86400000)return disclose(remembered.result);
    const mx=roleMx??await mxLookup(domain);
    if(mx==='none')return disclose(await remember(input,email,{status:'invalid',label:'This email domain has no mail server'}));
    const deadline=Date.now()+110000;
    let checked:Awaited<ReturnType<WorkerClient['verifyEmail']>>;
    try {
      const worker=deps.worker??deps.workerFactory?.()??makeWorkerClient({usage:service,orgId,
        config:await resolveOrgWorkerConfig(service,orgId,Deno.env.get('WORKER_SHARED_ORG_IDS')),
        verifyGate:sendGate(orgId),verifyTimeLeftMs:()=>Math.max(0,Math.min(deadline-Date.now(),input.timeLeftMs?.()??Infinity)),retryTransient:domain=>cachedMailProvider(domain)==='unknown'});
      checked=await worker.verifyEmail(email,{timeoutMs:33000});
    }catch{console.error('email precheck: checker unavailable');return disclose(verdict('unverifiable'));}
    if(!checked.ok)return disclose(checked.failure==='limit_reached'?{status:'unverifiable',label:'Not checked: daily check allowance reached'}:verdict('unverifiable'));
    const result=checked.value.status!=='invalid'&&roleAddressNeedsReview(email,cachedMailProvider(domain)??'unknown',checked.value.reason==='catch_all')
      ?{status:'unverifiable' as const,label:ROLE_ADDRESS_LABEL}:verdict(checked.value.status==='valid'?'valid':checked.value.status==='invalid'?'invalid':'unverifiable');
    if(['waiting_for_domain','lead_time_exhausted'].includes(checked.value.reason))return disclose(result);
    return disclose(await remember(input,email,result));
  };
}
/** Shared boundary used by every real send path; it never sends a message itself. */
export async function checkEmailBeforeSend(service:SupabaseClient,input:Input&{orgId:string}):Promise<EmailPrecheckResult> {
  return makeEmailPrechecker(service,input.orgId)(input);
}
