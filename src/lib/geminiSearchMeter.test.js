vi.mock('../../supabase/functions/_shared/geminiAdmission', () => ({ admitGemini: vi.fn(async()=>{}), recordGeminiRefusal: vi.fn(async()=>{}) }));
import {afterEach,expect,it,vi} from 'vitest'
import {countGeminiSearch,geminiSearchPresentation,parseGeminiSearchSnapshot} from '../../supabase/functions/_shared/geminiSearchMeter'
import {geminiGroundedSearch} from '../../supabase/functions/_shared/ai'
const success={candidates:[{content:{parts:[{text:'Result'}]},groundingMetadata:{groundingChunks:[]}}]};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
it.each(['success','provider_error','network_error'])('counts one dispatched %s call with correct org and key scope',async mode=>{
 const service={rpc:vi.fn(async()=>({data:null,error:null}))};vi.stubGlobal('fetch',vi.fn(async()=>{if(mode==='network_error')throw Error('network');return Response.json(mode==='success'?success:{error:'private'},{status:mode==='provider_error'?500:200})}));
 try{await geminiGroundedSearch('query','fixture-key',1000,{service,orgId:'org',sharedKey:true})}catch{}
 expect(service.rpc).toHaveBeenCalledExactlyOnceWith('gemini_search_count',{p_org:'org',p_shared:true,p_n:1});
});
it('does not dispatch or count when the local time allowance is already exhausted',async()=>{
 const service={rpc:vi.fn()},fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 await expect(geminiGroundedSearch('query','fixture-key',0,{service,orgId:'org',sharedKey:false})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();expect(service.rpc).not.toHaveBeenCalled();
});
it('never counts a missing-key lookup',async()=>{const service={rpc:vi.fn()};await geminiGroundedSearch('query','',1000,{service,orgId:'org',sharedKey:false});expect(service.rpc).not.toHaveBeenCalled()});
it('does not fail a lookup when counting fails and logs only the fixed code',async()=>{
 const service={rpc:vi.fn(async()=>({error:{message:'private secret'}}))},log=vi.spyOn(console,'error').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn(async()=>Response.json(success)));
 expect(await geminiGroundedSearch('query','fixture-key',1000,{service,orgId:'org',sharedKey:false})).toMatchObject({text:'Result'});expect(log.mock.calls).toEqual([['gemini_search_count_failed']]);
});
it('counts failures thrown by the database without leaking provider or secret text',async()=>{const log=vi.spyOn(console,'error').mockImplementation(()=>{});await expect(countGeminiSearch({rpc:async()=>{throw Error('private')}},'org',false)).resolves.toBeUndefined();expect(log.mock.calls).toEqual([['gemini_search_count_failed']])});
it.each([[3999,'ok',false],[4000,'warning',false],[4999,'warning',false],[5000,'full',true]])('shows %i with %s status', (count,state,billed)=>{
 const result=geminiSearchPresentation({orgSearches:count,sharedKey:false,sharedSearches:null});expect(result.state).toBe(state);expect(result.text).toBe('Web searches by Gemini this month: about '+count.toLocaleString('en-GB')+' of 5,000 free.'+(billed?' Searches beyond this are billed by Google.':''));
});
it('uses shared total only for shared-key orgs and refuses malformed snapshots',()=>{
 const parsed=parseGeminiSearchSnapshot({org_searches:10,shared_key:true,shared_searches:4500});expect(geminiSearchPresentation(parsed).state).toBe('warning');expect(geminiSearchPresentation(parsed).text).toContain('4,500');expect(parseGeminiSearchSnapshot({org_searches:10,shared_key:true,shared_searches:null})).toBeNull();expect(parseGeminiSearchSnapshot({org_searches:-1,shared_key:false,shared_searches:null})).toBeNull();
});
