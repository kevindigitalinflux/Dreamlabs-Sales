import {expect,it,vi} from 'vitest'
import {searchWeb} from './search.js'
const reply=(body:unknown,status=200)=>async()=>new Response(JSON.stringify(body),{status})
it('caps eight safe results, trims fields and sends only the fixed search parameters',async()=>{
 let url='';const result=await searchWeb('company manager',{searxUrl:'http://searxng:8080',fetchImpl:async input=>{url=String(input);return reply({results:[{title:'bad',url:'javascript:alert(1)',content:'bad'},...Array.from({length:50},()=>({title:'x'.repeat(300),url:'https://fixture.test/person',content:'y'.repeat(900)}))]})()}});
 expect(new URL(url).searchParams.get('q')).toBe('company manager');expect(new URL(url).searchParams.get('format')).toBe('json');expect(new URL(url).searchParams.get('language')).toBe('en');expect(new URL(url).searchParams.get('safesearch')).toBe('0');
 expect(result.ok).toBe(true);if(result.ok){expect(result.results).toHaveLength(8);expect(result.results[0]).toEqual({title:'x'.repeat(200),url:'https://fixture.test/person',snippet:'y'.repeat(400)})}
});
it.each([[429,'throttled'],[500,'upstream']] as const)('maps HTTP %i to %s',async(status,error)=>{expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:reply({},status)})).toEqual({ok:false,error})});
it('rejects HTML and malformed results without raw text',async()=>{
 expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:async()=>new Response('<secret>')})).toEqual({ok:false,error:'bad_response'});
 expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:reply({results:'bad'})})).toEqual({ok:false,error:'bad_response'});
});
it('reports throttled when all engines are suspended, but preserves partial hits',async()=>{
 expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:reply({results:[],unresponsive_engines:['google','bing','duckduckgo','brave','startpage','mojeek'].map(engine=>[engine,'Suspended'])})})).toEqual({ok:false,error:'throttled'});
 expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:reply({results:[{title:'ok',url:'https://fixture.test',content:'ok'}],unresponsive_engines:[['google','CAPTCHA']]})})).toMatchObject({ok:true});
});
it('aborts after twelve seconds and returns timeout',async()=>{
 vi.useFakeTimers();try {let aborted=false;const pending=searchWeb('query',{searxUrl:'http://fixture',fetchImpl:async(_url,init)=>new Promise<Response>((_r,reject)=>init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'))}))});await vi.advanceTimersByTimeAsync(11999);expect(aborted).toBe(false);await vi.advanceTimersByTimeAsync(1);expect(await pending).toEqual({ok:false,error:'timeout'})}finally{vi.useRealTimers()}
});
it('keeps a network failure fixed as upstream',async()=>{expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:async()=>{throw new Error('provider secret')}})).toEqual({ok:false,error:'upstream'})});

it('does not call zero results throttled when only one engine is unavailable',async()=>{
 expect(await searchWeb('query',{searxUrl:'http://fixture',fetchImpl:reply({results:[],unresponsive_engines:[['google','CAPTCHA']]})})).toEqual({ok:true,results:[]});
});
