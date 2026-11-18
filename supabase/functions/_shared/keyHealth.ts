import {classifyKeyFailure,type KeyProvider,type KeyFeature} from './keyHealthRules.ts';

export interface HealthService {rpc(name:string,args:Record<string,unknown>):PromiseLike<{error?:unknown;data?:unknown}>}
export interface KeyHealthInvocation {ok:Set<string>}
export interface KeyHealthContext {service:HealthService;orgId:string;provider:KeyProvider;keySource:'org'|'global';feature:KeyFeature;invocation:KeyHealthInvocation}

/** Create once per request, never once per module/isolate. */
export function createKeyHealthInvocation():KeyHealthInvocation {return {ok:new Set()};}

function persist(context:KeyHealthContext,name:string,args:Record<string,unknown>):Promise<void> {
  const task=(async()=>{try{const result=await context.service.rpc(name,args);if(result.error)console.error('api_key_health_write_failed');}catch{console.error('api_key_health_write_failed');}})();
  const runtime=(globalThis as unknown as {EdgeRuntime?:{waitUntil(task:Promise<unknown>):void}}).EdgeRuntime;
  try{runtime?.waitUntil(task);}catch{console.error('api_key_health_background_unavailable');}
  return task;
}

/** Best-effort telemetry cannot change the feature's provider result. */
export function recordKeyFailure(context:KeyHealthContext|undefined,status:number,bodyHint?:unknown):Promise<void> {
  if(!context)return Promise.resolve();
  const state=classifyKeyFailure(context.provider,status,bodyHint);
  if(!state)return Promise.resolve();
  return persist(context,'api_key_failure',{p_org:context.orgId,p_provider:context.provider,p_state:state,p_code:status,p_source:context.keySource,p_feature:context.feature});
}

/** Mark the memo before awaiting, so parallel successes clear only once in this invocation. */
export function recordKeyOk(context:KeyHealthContext|undefined):Promise<void> {
  if(!context)return Promise.resolve();
  const key=`${context.orgId}:${context.provider}`;
  if(context.invocation.ok.has(key))return Promise.resolve();
  context.invocation.ok.add(key);
  return persist(context,'api_key_ok',{p_org:context.orgId,p_provider:context.provider});
}
