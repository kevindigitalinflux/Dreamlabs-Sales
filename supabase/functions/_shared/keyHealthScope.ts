/// <reference path="./nodeAsyncHooks.d.ts" />
import {AsyncLocalStorage} from 'node:async_hooks';
import {createKeyHealthInvocation,recordKeyOk,type HealthService,type KeyHealthContext,type KeyHealthInvocation} from './keyHealth.ts';
import type {KeyFeature,KeyProvider} from './keyHealthRules.ts';

interface Binding {context:KeyHealthContext;credential:string;origin?:string}
interface Scope {feature:KeyFeature;orgId?:string;invocation:KeyHealthInvocation;bindings:Map<string,Binding>}
const scopes=new AsyncLocalStorage<Scope>();

/** One context per HTTP invocation, with an independent memo and no global fetch patch. */
export function withKeyHealthRequest<T>(feature:KeyFeature,action:()=>T):T {
  return scopes.run({feature,invocation:createKeyHealthInvocation(),bindings:new Map()},action);
}
/** Bind background org work explicitly so shared credentials cannot cross parallel organisation boundaries. */
export function withKeyHealthOrg<T>(orgId:string,action:()=>T):T {
  const scope=scopes.getStore();return scope?scopes.run({...scope,orgId},action):action();
}
/** A fixed feature code can be narrowed within a provider operation. */
export function withKeyHealthFeature<T>(feature:KeyFeature,action:()=>T):T {
  const scope=scopes.getStore();return scope?scopes.run({...scope,feature},action):action();
}
/** Wrap the native edge handler without changing auth, response handling or other fetch consumers. */
export function keyHealthHandler(feature:KeyFeature,handler:(req:Request)=>Promise<Response>) {
  return (req:Request)=>withKeyHealthRequest(feature,()=>handler(req));
}
/** Source is supplied at the resolver's onSource event; credentials remain invocation-local and never leave this map. */
export function bindKeyHealth(service:HealthService,orgId:string,provider:KeyProvider,credential:string,source:'org'|'global',endpoint?:string):void {
  const scope=scopes.getStore();if(!scope||!credential)return;
  let origin:string|undefined;
  if(endpoint){try{origin=new URL(endpoint).origin;}catch{return;}}
  if(provider==='cro'){const split=credential.indexOf(':');if(split>=0)credential=credential.slice(0,split).trim()+':'+credential.slice(split+1).trim();}
  const binding={context:{service,orgId,provider,keySource:source,feature:scope.feature,invocation:scope.invocation},credential,origin};
  const key=JSON.stringify([orgId,provider,credential]);scope.bindings.delete(key);scope.bindings.set(key,binding);
}

/** A successful save/test clears after its response observations, including validators injected by fixtures. */
export function savedKeyHealthOk(service:HealthService,orgId:string,provider:KeyProvider):void {
  const scope=scopes.getStore();if(!scope)return;
  const key=`${orgId}:${provider}`;
  const task=(scope.invocation.observations.get(key)??Promise.resolve()).then(()=>recordKeyOk({service,orgId,provider,keySource:'org',feature:'key_test',invocation:scope.invocation}));
  scope.invocation.observations.set(key,task);
  try{(globalThis as unknown as {EdgeRuntime?:{waitUntil(task:Promise<unknown>):void}}).EdgeRuntime?.waitUntil(task);}catch{console.error('api_key_health_background_unavailable');}
}

/** Match only an actual provider credential at an approved provider host (or the configured worker origin). */
export function requestKeyHealth(url:URL,headers:Headers,orgId?:string):KeyHealthContext|undefined {
  const scope=scopes.getStore();if(!scope)return;
  const basic=()=>{try{return atob((headers.get('authorization')??'').replace(/^Basic\s+/i,''));}catch{return '';}};
  const bearer=(headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
  const host=url.hostname.toLowerCase();
  for(const binding of [...scope.bindings.values()].reverse()) {
    const {provider}=binding.context;
    if((orgId??scope.orgId)&&binding.context.orgId!==(orgId??scope.orgId))continue;
    let credential:string|null=null;
    if(provider==='gemini'&&host==='generativelanguage.googleapis.com')credential=headers.get('x-goog-api-key')??url.searchParams.get('key');
    if(provider==='anthropic'&&host==='api.anthropic.com')credential=headers.get('x-api-key');
    if(provider==='hunter'&&host==='api.hunter.io')credential=headers.get('x-api-key')??url.searchParams.get('api_key');
    if(provider==='apollo'&&host==='api.apollo.io')credential=headers.get('x-api-key');
    if((provider==='google_places'||provider==='google_places_pro')&&['places.googleapis.com','maps.googleapis.com'].includes(host))credential=headers.get('x-goog-api-key')??url.searchParams.get('key');
    if(provider==='companies_house'&&host==='api.company-information.service.gov.uk')credential=basic().replace(/:$/,'');
    if(provider==='cro'&&(host==='services.cro.ie'||host.endsWith('.cro.ie')))credential=basic();
    if(provider==='opencorporates'&&host==='api.opencorporates.com')credential=url.searchParams.get('api_token');
    if(provider==='firecrawl'&&host==='api.firecrawl.dev')credential=bearer;
    if(provider==='lookup_worker'&&url.origin===binding.origin)credential=headers.get('x-worker-secret');
    if(provider==='email_verifier'&&url.origin===binding.origin)credential=bearer||headers.get('x-api-key');
    if(credential===binding.credential)return {...binding.context,feature:scope.feature};
  }
}
