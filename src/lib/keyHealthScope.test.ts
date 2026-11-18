import {afterEach,expect,it,vi} from 'vitest';
import {withKeyHealthRequest,withKeyHealthOrg,bindKeyHealth} from '../../supabase/functions/_shared/keyHealthScope';
import {keyHealthFetch} from '../../supabase/functions/_shared/keyHealthFetch';
const pending:Promise<unknown>[]=[];
afterEach(()=>{vi.unstubAllGlobals();pending.length=0});
async function flush(){for(let i=0;i<3;i++){await Promise.allSettled(pending);await new Promise(resolve=>setTimeout(resolve,0));}}
const cases=[
 ['gemini','https://generativelanguage.googleapis.com/test',{headers:{'x-goog-api-key':'fixture'}}],
 ['anthropic','https://api.anthropic.com/test',{headers:{'x-api-key':'fixture'}}],
 ['hunter','https://api.hunter.io/test?api_key=fixture',{}],
 ['apollo','https://api.apollo.io/test',{headers:{'X-Api-Key':'fixture'}}],
 ['google_places','https://maps.googleapis.com/test?key=fixture',{}],
 ['google_places_pro','https://places.googleapis.com/test',{headers:{'X-Goog-Api-Key':'fixture'}}],
 ['companies_house','https://api.company-information.service.gov.uk/test',{headers:{Authorization:'Basic '+btoa('fixture:')}}],
 ['cro','https://services.cro.ie/test',{headers:{Authorization:'Basic '+btoa('fixture')}}],
 ['opencorporates','https://api.opencorporates.com/test?api_token=fixture',{}],
 ['firecrawl','https://api.firecrawl.dev/test',{headers:{Authorization:'Bearer fixture'}}],
 ['lookup_worker','https://worker.fixture.test/test',{headers:{'x-worker-secret':'fixture'}}],
] as const;
it.each(cases)('records %s at its response boundary without consuming its body',async(provider,url,init)=>{
 vi.stubGlobal('EdgeRuntime',{waitUntil:(task:Promise<unknown>)=>pending.push(task)});
 const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:true}));
 await withKeyHealthRequest('lookup',async()=>{
  bindKeyHealth({rpc},'org',provider,'fixture','global',provider==='lookup_worker'?'https://worker.fixture.test':undefined);
  const response=await keyHealthFetch(url,init,async()=>Response.json({error:'private reply'}, {status:402}));
  expect(await response.json()).toEqual({error:'private reply'});await flush();
 });
 expect(rpc).toHaveBeenCalledWith('api_key_failure',{p_org:'org',p_provider:provider,p_state:'needs_topup',p_code:402,p_source:'global',p_feature:'lookup'});
 expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/private|https|fixture/);
});
it('isolates concurrent organisations using the same shared key',async()=>{
 vi.stubGlobal('EdgeRuntime',{waitUntil:(task:Promise<unknown>)=>pending.push(task)});const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:true}));
 await withKeyHealthRequest('deep_find',async()=>{
  await Promise.all(['a','b'].map(org=>withKeyHealthOrg(org,async()=>{
   bindKeyHealth({rpc},org,'gemini','same-key','global');await Promise.resolve();
   await keyHealthFetch('https://generativelanguage.googleapis.com/test',{headers:{'x-goog-api-key':'same-key'}},async()=>Response.json({}, {status:org==='a'?402:200}));
  })));await flush();
 });
 expect(rpc).toHaveBeenCalledWith('api_key_failure',expect.objectContaining({p_org:'a'}));
 expect(rpc).toHaveBeenCalledWith('api_key_ok',{p_org:'b',p_provider:'gemini'});
 expect(rpc.mock.calls.some(([name,args])=>name==='api_key_ok'&&args.p_org==='a')).toBe(false);
});
it('leaves transport results intact when telemetry fails and ignores 5xx/network failures',async()=>{
 vi.stubGlobal('EdgeRuntime',{waitUntil:(task:Promise<unknown>)=>pending.push(task)});vi.spyOn(console,'error').mockImplementation(()=>{});
 const rpc=vi.fn(async()=>{throw Error('private')});
 await withKeyHealthRequest('drafting',async()=>{
  bindKeyHealth({rpc},'org','gemini','fixture','org');
  const request=()=>keyHealthFetch('https://generativelanguage.googleapis.com/test?key=fixture',{},async()=>Response.json({answer:1}));
  expect(await (await request()).json()).toEqual({answer:1});await request();await flush();expect(rpc).toHaveBeenCalledTimes(1);
 });vi.restoreAllMocks();
});
it('records Apollo health endpoint false-auth as a key refusal even with HTTP 200',async()=>{
 vi.stubGlobal('EdgeRuntime',{waitUntil:(task:Promise<unknown>)=>pending.push(task)});const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:true}));
 await withKeyHealthRequest('key_test',async()=>{bindKeyHealth({rpc},'org','apollo','fixture','org');await keyHealthFetch('https://api.apollo.io/api/v1/auth/health',{headers:{'X-Api-Key':'fixture'}},async()=>Response.json({is_logged_in:false}));await flush();});
 expect(rpc).toHaveBeenCalledWith('api_key_failure',expect.objectContaining({p_provider:'apollo',p_state:'refused',p_code:401}));
 expect(rpc.mock.calls.some(([name])=>name==='api_key_ok')).toBe(false);
});
it('orders slow quota observations before a later successful retry',async()=>{
 vi.stubGlobal('EdgeRuntime',{waitUntil:(task:Promise<unknown>)=>pending.push(task)});const rpc=vi.fn(async(_name:string,_args:Record<string,unknown>)=>({data:true}));
 await withKeyHealthRequest('lookup',async()=>{bindKeyHealth({rpc},'org','gemini','fixture','org');const init={headers:{'x-goog-api-key':'fixture'}};
 await keyHealthFetch('https://generativelanguage.googleapis.com/test',init,async()=>Response.json({error:{message:'daily quota exhausted'}},{status:429}));
 await keyHealthFetch('https://generativelanguage.googleapis.com/test',init,async()=>Response.json({}));await flush();});
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(['api_key_failure','api_key_ok']);
});
