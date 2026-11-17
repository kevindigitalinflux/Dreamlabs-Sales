import {expect,it,vi} from 'vitest';
import {rolePeoplePrompt,judgeRolePerson} from '../../supabase/functions/_shared/roleSearchRules';
import {makeSearchProvider} from '../../supabase/functions/_shared/searchProvider';
import {findRolePeople} from '../../supabase/functions/_shared/roleSearch';
const context={company:'Acme Offices',city:'London',country:'GB',roles:['Owner'],rung:'final' as const};
const person={name:'Jane Doe',title:'Owner',company:'Acme Offices',linkedin_url:'https://linkedin.com/in/jane-doe'};
const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED';
const reply={text:'Jane Doe currently owns Acme Offices. '+redirect+'\n'+JSON.stringify(person),sources:[redirect],sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Jane Doe is Owner at Acme Offices.`]};
const provider=(value=reply,onFallbackShape=vi.fn())=>makeSearchProvider({worker:{search:async()=>({ok:false as const,failure:'not_configured' as const,line:''})} as never,gemini:async()=>value,reserveAi:async()=>true,onFallbackShape});
const cleancat={company:'Cleancat - Commercial Cleaning Services Dublin',city:'Dublin'};
const finalRung={rung:'final' as const,roles:['Owner','Founder','Director']};
const ann={name:'Ann Roe',title:'Director',company:'Cleancat'};
it.each([
 'Ann Roe is a Director at Cleancat Logistics Ltd in Cork.',
 'Ann Roe, Director.',
 'Ann Roe founded Cleancat. She is now Director at Brightway.',
 'Ann Roe is Director at Cleancat. Ann Roe is Owner of Brightway.',
 'Ann Roe is Director at Cleancat. Experience: Brightway Ltd.',
 'Ann Roe, Director, Cleancat Logistics Ltd.',
 'Ann Roe is Founder of Cleancat with Brightway Logistics Ltd.',
])('requires source-only company proof and vetoes every conflicting phrase: %s',evidence=>{
 expect(judgeRolePerson({...ann,evidence},cleancat,finalRung)).toEqual({ok:false,why:'company_mismatch'});
});
it.each([
 'Ann Roe is the founder of Cleancat, a commercial cleaning company in Dublin.',
 'Ann Roe, Founder at Cleancat Ltd',
])('accepts a grounded role at the actual brand: %s',evidence=>{
 expect(judgeRolePerson({...ann,evidence},cleancat,finalRung)).toMatchObject({ok:true,person:{first:'Ann',last:'Roe',title:'Founder'}});
});
it('rejects the model company claim even when source evidence matches',()=>{
 expect(judgeRolePerson({...ann,company:'Brightway',evidence:'Ann Roe is Founder at Cleancat.'},cleancat,finalRung)).toEqual({ok:false,why:'company_mismatch'});
});
it('does not bind a company mention to a role in a different sentence',()=>{
 expect(judgeRolePerson({...ann,evidence:'Ann Roe works at Cleancat. She is Director of her football club.'},cleancat,finalRung)).not.toMatchObject({ok:true});
 expect(judgeRolePerson({...ann,evidence:'Ann Roe works at Cleancat. Director.'},cleancat,finalRung)).toEqual({ok:false,why:'role_mismatch'});
});
it('does not let the model title replace missing role words in company evidence',()=>{
 expect(judgeRolePerson({...person,evidence:'Jane Doe currently owns Acme Offices.'},context,{rung:'final',roles:['Owner']})).toEqual({ok:false,why:'role_mismatch'});
});
it('does not borrow company proof or role words from an unrelated source row',async()=>{
 const value={...reply,sourceEvidence:[`${redirect} Jane Doe, Owner.`,`${redirect} Someone Else is Owner at Acme Offices.`]};
 expect(await provider(value).search('query',context)).toMatchObject({ok:true,people:[]});
});
it('preserves company and role phrases that contain of, and source-only registered names',()=>{
 expect(judgeRolePerson({name:'Ann Roe',title:'Head of Operations',company:'At Home',evidence:'Ann Roe is Head of Operations at At Home Ltd.'},{company:'At Home'},{rung:'target',roles:['Head of Operations']})).toMatchObject({ok:true});
 expect(judgeRolePerson({...ann,company:'Trading Brand',evidence:'Ann Roe is Director at Registered Services Ltd.'},{company:'Trading Brand',registeredName:'Registered Services Ltd'},finalRung)).toMatchObject({ok:true});
});
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
 expect(judgeRolePerson({...person,evidence:'Jane Doe is Owner at Acme Offices.'},context,{rung:'final',roles:['Owner']})).toMatchObject({ok:true,person:{first:'Jane',last:'Doe',linkedinUrl:null}});
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
 expect(shape).toHaveBeenCalledExactlyOnceWith({lines_parsed:1,profile_urls:1,sources:0,redirect_sources:0,linkedin_titled_sources:0,people_lines:1,people_kept:0,objects_found:1});
});
it.each([
 JSON.stringify(person),
 JSON.stringify(person,null,2),
 '```json\n'+JSON.stringify([person],null,2)+'\n```',
 'Public person:\n'+JSON.stringify(person,null,2)+'\nEnd.',
 '{invalid}\n'+JSON.stringify(person),
])('keeps the grounded person across Gemini object layouts: %s',async text=>{
 expect(await provider({...reply,text}).search('query',context)).toMatchObject({people:[{first:'Jane',last:'Doe'}]});
});
