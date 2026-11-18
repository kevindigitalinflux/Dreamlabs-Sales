import {recordKeyFailure,recordKeyOk,type KeyHealthContext} from './keyHealth.ts';
import {requestKeyHealth} from './keyHealthScope.ts';

async function responseHint(response:Response):Promise<unknown> {
  const reader=response.body?.getReader();if(!reader)return null;
  let hint='';const decoder=new TextDecoder();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([(async()=>{let bytes=0;while(bytes<4096){const part=await reader.read();if(part.done)break;const size=Math.min(part.value.length,4096-bytes);hint+=decoder.decode(part.value.subarray(0,size),{stream:true});bytes+=size;}hint+=decoder.decode();})(),
      new Promise<void>(resolve=>{timer=setTimeout(resolve,1500);})]);
    try{return JSON.parse(hint);}catch{return hint;}
  } finally {if(timer)clearTimeout(timer);void reader.cancel().catch(()=>{});}
}

async function observe(response:Response,context:KeyHealthContext):Promise<void> {
  try {
    const needsHint=response.status===429||((context.provider==='google_places'||context.provider==='google_places_pro'||(context.provider==='apollo'&&context.feature==='key_test'))&&response.ok);
    const hint=needsHint?await responseHint(response):null;
    if(context.provider==='apollo'&&hint&&typeof hint==='object'&&'is_logged_in' in hint&&hint.is_logged_in===false){await recordKeyFailure(context,401);return;}
    const legacy=hint&&typeof hint==='object'?'status' in hint?String(hint.status):null:null;
    if(legacy==='REQUEST_DENIED'){await recordKeyFailure(context,403);return;}
    if(legacy==='OVER_QUERY_LIMIT'){await recordKeyFailure(context,429,hint);return;}
    if(legacy&&legacy!=='OK'&&legacy!=='ZERO_RESULTS')return;
    if(response.ok){await recordKeyOk(context);return;}
    await recordKeyFailure(context,response.status,hint);
  }catch{console.error('api_key_health_observation_failed');}
}

/** Observe a response without consuming it, changing errors/retries, or awaiting telemetry. */
export async function keyHealthFetch(input:RequestInfo|URL,init?:RequestInit,request:typeof fetch=globalThis.fetch,orgId?:string):Promise<Response> {
  let context:KeyHealthContext|undefined;
  try{const url=new URL(input instanceof Request?input.url:String(input));context=requestKeyHealth(url,new Headers(init?.headers??(input instanceof Request?input.headers:undefined)),orgId);}catch{console.error('api_key_health_request_unmatched');}
  const response=await request(input,init);
  if(context)try{
    const key=`${context.orgId}:${context.provider}`;
    const needsHint=response.status===429||((context.provider==='google_places'||context.provider==='google_places_pro'||(context.provider==='apollo'&&context.feature==='key_test'))&&response.ok);
    // Clone before returning: later observations may wait behind an earlier response for this key.
    const observed=needsHint?response.clone():response;
    const task=(context.invocation.observations.get(key)??Promise.resolve()).then(()=>observe(observed,context));
    context.invocation.observations.set(key,task);
    try{(globalThis as unknown as {EdgeRuntime?:{waitUntil(task:Promise<unknown>):void}}).EdgeRuntime?.waitUntil(task);}catch{console.error('api_key_health_background_unavailable');}
  }
  catch{console.error('api_key_health_observation_failed');}
  return response;
}
