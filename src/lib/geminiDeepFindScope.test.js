import {afterEach,expect,it,vi} from 'vitest';
import {draftEmail,geminiGroundedSearch} from '../../supabase/functions/_shared/ai';
afterEach(()=>vi.unstubAllGlobals());
it('drafts without an admission RPC even when the Deep find guard would be unavailable',async()=>{
 vi.stubGlobal('Deno',{env:{get:()=>{throw Error('No admission environment reads allowed')}}});
 const fetcher=vi.fn(async(url)=>{expect(String(url)).toContain('generativelanguage.googleapis.com');return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({subject:'Fixture',body:'Hello'})}]}}]})});
 vi.stubGlobal('fetch',fetcher);
 expect(await draftEmail({subject:'Fixture',body:'Hello',lead:{},notes:[],contractorName:'Fixture',orgName:'Fixture',apiKey:'fake'})).toMatchObject({subject:'Fixture',body:'Hello'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('grounded non-Deep-find calls still meter monthly usage without a minute or run RPC',async()=>{
 const rpc=vi.fn(async()=>({data:true}));vi.stubGlobal('fetch',vi.fn(async()=>Response.json({candidates:[{content:{parts:[{text:'Fixture'}]}}]})));
 expect(await geminiGroundedSearch('fixture','fake',1000,{service:{rpc},orgId:'org',sharedKey:false})).toMatchObject({text:'Fixture'});
 expect(rpc.mock.calls).toEqual([['gemini_search_count',{p_org:'org',p_shared:false,p_n:1}]]);
});
