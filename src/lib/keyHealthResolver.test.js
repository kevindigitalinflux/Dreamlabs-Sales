import {afterEach,expect,it,vi} from 'vitest';
import {resolveOrgApiKey} from '../../supabase/functions/_shared/orgApiKeys';
import {withKeyHealthRequest} from '../../supabase/functions/_shared/keyHealthScope';
import {keyHealthFetch} from '../../supabase/functions/_shared/keyHealthFetch';
afterEach(()=>vi.unstubAllGlobals());
it.each(['org','global'])('carries the resolver source event into a real transport health record: %s',async source=>{
 const pending=[];vi.stubGlobal('EdgeRuntime',{waitUntil:task=>pending.push(task)});vi.stubGlobal('Deno',{env:{get:()=> 'fixture-key'}});
 const rpc=vi.fn(async name=>({data:name==='app_get_org_api_key'?'fixture-key':null}));
 const service={rpc,from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{is_configured:source==='org'}}),single:async()=>({data:{use_global_api_fallback:true}})};return q;}};
 const onSource=vi.fn();await withKeyHealthRequest('drafting',async()=>{
  const key=await resolveOrgApiKey(service,'org','gemini',onSource);
  await keyHealthFetch('https://generativelanguage.googleapis.com/test',{headers:{'x-goog-api-key':key}},async()=>Response.json({error:'private'},{status:402}));
  await Promise.allSettled(pending);
 });
 expect(onSource).toHaveBeenCalledWith(source);expect(rpc).toHaveBeenCalledWith('api_key_failure',{p_org:'org',p_provider:'gemini',p_state:'needs_topup',p_code:402,p_source:source,p_feature:'drafting'});
});
