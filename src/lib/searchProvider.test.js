import {expect,it,vi} from 'vitest'
import {makeSearchProvider} from '../../supabase/functions/_shared/searchProvider'
const hit={title:'Jane Doe - Facilities Manager - Acme Offices',url:'https://linkedin.com/in/jane',snippet:'Facilities Manager at Acme Offices'};
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
