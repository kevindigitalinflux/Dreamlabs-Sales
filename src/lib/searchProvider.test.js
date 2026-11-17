import {expect,it,vi} from 'vitest'
import {makeSearchProvider} from '../../supabase/functions/_shared/searchProvider'
import {findRolePeople} from '../../supabase/functions/_shared/roleSearch'
const hit={title:'Jane Doe - Facilities Manager - Acme Offices',url:'https://linkedin.com/in/jane',snippet:'Facilities Manager at Acme Offices'};
it('disables an unconfigured worker for this lead without counting SearXNG, preserving Gemini rungs',async()=>{
 const worker={search:vi.fn(async()=>({ok:false,failure:'not_configured'}))},gemini=vi.fn(async()=>({text:'',sources:[]})),reserveAi=vi.fn(async()=>true),onSearch=vi.fn();
 const provider=makeSearchProvider({worker,gemini,reserveAi,onSearch});
 await findRolePeople({company:'Acme Offices',profile:{targetRoles:['Manager']},provider,timeLeftMs:()=>100000});
 expect(worker.search).toHaveBeenCalledTimes(1);expect(gemini).toHaveBeenCalledTimes(3);expect(reserveAi).toHaveBeenCalledTimes(3);expect(onSearch.mock.calls).toEqual([['gemini'],['gemini'],['gemini']]);
 await makeSearchProvider({worker,gemini,reserveAi,onSearch}).search('another lead');expect(worker.search).toHaveBeenCalledTimes(2);
});
// Synthetic contract fixture, not a captured Gemini reply. Real-call Step 1 was withdrawn.
const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED';
const redirectReply={text:JSON.stringify(hit),sources:[redirect],sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Jane Doe is Facilities Manager at Acme Offices.`]};
const fallback=(reply,onFallbackShape)=>makeSearchProvider({worker:{search:async()=>({ok:false,failure:'not_configured'})},reserveAi:async()=>true,gemini:async()=>reply,onFallbackShape});
it('keeps Shape A direct URL matches without requiring sourceEvidence',async()=>{
 expect(await fallback({text:JSON.stringify(hit),sources:[hit.url]}).search('query')).toMatchObject({ok:true,hits:[hit]});
});
it('keeps Shape B redirect hits supported by a LinkedIn chunk',async()=>{
 expect(await fallback(redirectReply).search('query')).toMatchObject({ok:true,hits:[hit]});
});
it.each(['uk.linkedin.com','en-gb.linkedin.com'])('accepts regional LinkedIn chunk title %s',domain=>{
 return expect(fallback({...redirectReply,sourceEvidence:[`${redirect} ${domain}`,redirectReply.sourceEvidence[1]]}).search('query')).resolves.toMatchObject({ok:true,hits:[hit]});
});
it.each([
 {sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Someone Else is Facilities Manager.`]},
 {sourceEvidence:[`${redirect} example.com`,redirectReply.sourceEvidence[1]]},
 {sourceEvidence:[`${redirect} linkedin.com.attacker.test`,redirectReply.sourceEvidence[1]]},
 {sourceEvidence:[`${redirect} linkedin.com`,`${redirect}-other Jane Doe at Acme Offices.`]},
 {sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Janette Doerr at Acme Offices.`]},
 {sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Jane Doe at Acme Offices.`],sources:['https://attacker.test/grounding-api-redirect/REDACTED']},
])('drops missing, unrelated or spoofed redirect grounding %#',async patch=>{
 expect(await fallback({...redirectReply,...patch}).search('query')).toMatchObject({ok:true,hits:[]});
});
it('accepts a LinkedIn source host with same-chunk supported name evidence',async()=>{
 const source='https://uk.linkedin.com/in/grounded-person';
 expect(await fallback({...redirectReply,sources:[source],sourceEvidence:[`${source} Profile`,`${source} Jane Doe at Acme Offices`]}).search('query')).toMatchObject({ok:true,hits:[hit]});
});
it('does not borrow a name supported only by another non-LinkedIn chunk',async()=>{
 const other='https://example.com/source';
 expect(await fallback({...redirectReply,sources:[redirect,other],sourceEvidence:[`${redirect} linkedin.com`,`${other} Jane Doe at Acme Offices`]}).search('query')).toMatchObject({ok:true,hits:[]});
});
it.each(['https://linkedin.com/company/acme','https://linkedin.com.attacker.test/in/jane','https://attacker.linkedin.com/in/jane','https://user@linkedin.com/in/jane'])('drops invented or invalid profile URL %s',url=>{
 return expect(fallback({...redirectReply,text:JSON.stringify({...hit,url})}).search('query')).resolves.toMatchObject({ok:true,hits:[]});
});
it('emits only fixed numeric fallback shape counts when no hit is kept',async()=>{
 const onFallbackShape=vi.fn();const reply={...redirectReply,text:['prose','{bad}',JSON.stringify({...hit,title:'Someone Else - Director - Acme Offices'}),JSON.stringify({...hit,url:'https://linkedin.com/company/acme'})].join('\n')};
 expect(await fallback(reply,onFallbackShape).search('private query')).toMatchObject({ok:true,hits:[]});
 expect(onFallbackShape).toHaveBeenCalledExactlyOnceWith({lines_parsed:2,profile_urls:1,sources:1,redirect_sources:1,linkedin_titled_sources:1});
 expect(JSON.stringify(onFallbackShape.mock.calls)).not.toMatch(/Jane|Doe|query|https|Acme/);
 const kept=vi.fn();await fallback(redirectReply,kept).search('query');expect(kept).not.toHaveBeenCalled();
});
it('three empty rungs reserve exactly one AI unit per lead',async()=>{
 const reserveAi=vi.fn(async()=>true),gemini=vi.fn(async()=>({text:'',sources:[]}));
 const worker={search:vi.fn(async()=>({ok:true,value:[]}))};
 const provider=makeSearchProvider({worker,reserveAi,gemini});
 expect(await findRolePeople({company:'Acme Offices',profile:{targetRoles:['Facilities Manager']},provider,timeLeftMs:()=>100000})).toMatchObject({people:[],searches:3});
 expect(worker.search).toHaveBeenCalledTimes(3);expect(reserveAi).toHaveBeenCalledTimes(1);expect(gemini).toHaveBeenCalledTimes(1);
 expect(await provider.search('another empty rung')).toEqual({ok:false,why:'none'});
 const nextLead=makeSearchProvider({worker,reserveAi,gemini});await nextLead.search('new lead');expect(reserveAi).toHaveBeenCalledTimes(2);
});
it('a throttled second rung still falls back after the first empty rung',async()=>{
 const reserveAi=vi.fn(async()=>true),gemini=vi.fn().mockResolvedValueOnce({text:'',sources:[]}).mockResolvedValueOnce({text:JSON.stringify({...hit,title:'Jane Doe - Office Manager - Acme Offices',snippet:'Office Manager at Acme Offices'}),sources:[hit.url]});
 const worker={search:vi.fn().mockResolvedValueOnce({ok:true,value:[]}).mockResolvedValueOnce({ok:false,failure:'busy'})};
 const provider=makeSearchProvider({worker,reserveAi,gemini});
 expect(await findRolePeople({company:'Acme Offices',profile:{targetRoles:['Facilities Manager']},provider,timeLeftMs:()=>100000})).toMatchObject({people:[{first:'Jane',title:'Office Manager'}],searches:2});
 expect(reserveAi).toHaveBeenCalledTimes(2);expect(gemini).toHaveBeenCalledTimes(2);
});
it.each(['zero','busy','not_configured','unreachable'])('falls back only on %s and reserves one AI call',async failure=>{
 const reserveAi=vi.fn(async()=>true),gemini=vi.fn(async()=>({text:JSON.stringify(hit),sources:[hit.url]}));const worker={search:vi.fn(async()=>failure==='zero'?{ok:true,value:[]}:{ok:false,failure})};
 expect(await makeSearchProvider({worker,reserveAi,gemini}).search('query')).toEqual({ok:true,hits:[hit],via:'gemini'});expect(reserveAi).toHaveBeenCalledTimes(1);expect(gemini).toHaveBeenCalledTimes(1);
});
it.each(['timeout','bad_response','limit_reached','domain_stalled'])('does not fall back on %s',async failure=>{
 const gemini=vi.fn(),reserveAi=vi.fn();const result=await makeSearchProvider({worker:{search:async()=>({ok:false,failure})},gemini,reserveAi}).search('query');expect(result).toEqual({ok:false,why:failure==='limit_reached'?'limit':'failed'});expect(gemini).not.toHaveBeenCalled();expect(reserveAi).not.toHaveBeenCalled();
});
it('does not call Gemini when the run cap refuses',async()=>{const gemini=vi.fn();expect(await makeSearchProvider({worker:{search:async()=>({ok:true,value:[]})},reserveAi:async()=>false,gemini}).search('query')).toEqual({ok:false,why:'cap'});expect(gemini).not.toHaveBeenCalled()});
it('returns SearXNG hits without AI spending',async()=>{const reserveAi=vi.fn();expect(await makeSearchProvider({worker:{search:async()=>({ok:true,value:[hit]})},reserveAi}).search('query')).toEqual({ok:true,hits:[hit],via:'searxng'});expect(reserveAi).not.toHaveBeenCalled()});
it('accepts only grounded, valid JSON lines and never provider prose',async()=>{const result=await makeSearchProvider({worker:{search:async()=>({ok:true,value:[]})},reserveAi:async()=>true,gemini:async()=>({text:['prose','{bad}',JSON.stringify({...hit,url:'https://linkedin.com/in/invented'}),JSON.stringify(hit)].join('\n'),sources:[hit.url]})}).search('query');expect(result).toMatchObject({ok:true,hits:[hit]})});
it('keeps provider failures fixed and handles missing configuration',async()=>{
 expect(await makeSearchProvider({worker:{search:async()=>({ok:true,value:[]})},reserveAi:async()=>true}).search('query')).toEqual({ok:false,why:'none'});
 expect(await makeSearchProvider({worker:{search:async()=>({ok:true,value:[]})},reserveAi:async()=>true,gemini:async()=>{throw Error('private')}}).search('query')).toEqual({ok:false,why:'failed'});
});

it('records provider attempts without exposing queries, including a failed backup call',async()=>{
 const onSearch=vi.fn();await makeSearchProvider({worker:{search:async()=>({ok:true,value:[]})},reserveAi:async()=>true,gemini:async()=>{throw Error('private')},onSearch}).search('private query');expect(onSearch.mock.calls).toEqual([['searxng'],['gemini']]);
});
