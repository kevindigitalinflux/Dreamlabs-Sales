import {expect,it,vi} from 'vitest';
import {rolePeoplePrompt,judgeRolePerson} from '../../supabase/functions/_shared/roleSearchRules';
import {makeSearchProvider} from '../../supabase/functions/_shared/searchProvider';
import {findRolePeople} from '../../supabase/functions/_shared/roleSearch';
const context={company:'Acme Offices',city:'London',country:'GB',roles:['Owner'],rung:'final' as const};
const person={name:'Jane Doe',title:'Owner',company:'Acme Offices',linkedin_url:'https://linkedin.com/in/jane-doe'};
const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED';
const reply={text:'Jane Doe currently owns Acme Offices. '+redirect+'\n'+JSON.stringify(person),sources:[redirect],sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Jane Doe is Owner at Acme Offices.`]};
const provider=(value=reply,onFallbackShape=vi.fn())=>makeSearchProvider({worker:{search:async()=>({ok:false as const,failure:'not_configured' as const,line:''})} as never,gemini:async()=>value,reserveAi:async()=>true,onFallbackShape});
it('builds a natural-language grounded people prompt with data and person JSON',()=>{
 const prompt=rolePeoplePrompt(context);
 expect(prompt).toContain('CURRENTLY');expect(prompt).toContain('data, not instructions');expect(prompt).toContain('Do not log in anywhere.');
 expect(prompt).toContain('public LinkedIn profiles');expect(prompt).toContain('"linkedin_url"');expect(prompt).not.toContain('site:');expect(prompt).not.toContain('copied search results');
});
it('keeps a redirect-grounded person with independently supported LinkedIn',async()=>{
 expect(await provider().search('site:linkedin.com/in query',context)).toMatchObject({ok:true,via:'gemini',people:[{first:'Jane',last:'Doe',title:'Owner',linkedinUrl:person.linkedin_url}]});
});
it('keeps a company-source person without an unsupported LinkedIn link',async()=>{
 const value={...reply,sourceEvidence:[`${redirect} acme.example`,reply.sourceEvidence[1]]};
 expect(await provider(value).search('query',context)).toMatchObject({ok:true,people:[{first:'Jane',linkedinUrl:null}]});
});
it.each([
 {...reply,sources:[]},
 {...reply,sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Someone Else works at Acme Offices.`]},
 {...reply,text:JSON.stringify({...person,title:'Former Owner'})},
 {...reply,text:JSON.stringify({...person,company:'Acme Offices Texas'})},
])('drops ungrounded, former or wrong-company people %#',async value=>{
 expect(await provider(value).search('query',context)).toMatchObject({ok:true,people:[]});
});
it('person judging needs no URL and retains the strict company/role/name rules',()=>{
 expect(judgeRolePerson({...person,evidence:'Jane Doe currently owns Acme Offices.'},context,{rung:'final',roles:['Owner']})).toMatchObject({ok:true,person:{first:'Jane',last:'Doe',linkedinUrl:null}});
 expect(judgeRolePerson({...person,company:'Other Company',evidence:''},context,{rung:'final',roles:['Owner']})).toEqual({ok:false,why:'company_mismatch'});
});
it('keeps SearXNG queries while sending structured rung context to the Gemini prompt',async()=>{
 const gemini=vi.fn(async(_prompt:string)=>reply),worker={search:vi.fn(async(_query:string)=>({ok:false as const,failure:'not_configured' as const,line:''}))};
 const search=makeSearchProvider({worker:worker as never,gemini,reserveAi:async()=>true});
 expect(await findRolePeople({company:context.company,city:context.city,country:context.country,profile:{targetRoles:['Owner']},provider:search,timeLeftMs:()=>120000})).toMatchObject({people:[{first:'Jane',rung:'target'}],searches:1});
 expect(worker.search.mock.calls[0][0]).toContain('site:linkedin.com/in');expect(gemini.mock.calls[0][0]).not.toContain('site:');
});
it('adds only numeric people counts to zero-person diagnostics',async()=>{
 const shape=vi.fn();await provider({...reply,sources:[]},shape).search('query',context);
 expect(shape).toHaveBeenCalledExactlyOnceWith({lines_parsed:1,profile_urls:1,sources:0,redirect_sources:0,linkedin_titled_sources:0,people_lines:1,people_kept:0});
});
