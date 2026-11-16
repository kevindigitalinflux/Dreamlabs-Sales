import {expect,it,vi} from 'vitest'
import {findRolePeople,roleContactPlan,chooseRoleProfile,prioritizeRolePeople,officersForRoleSearch,roleSearchLine} from '../../supabase/functions/_shared/roleSearch'
import {mapCompaniesHouseOfficers} from '../../supabase/functions/_shared/registryOfficers'
const person={first:'Jane',last:'Doe',title:'Facilities Manager',linkedinUrl:'https://linkedin.com/in/jane',rung:'target'};
const hit=(name='Jane Doe')=>({title:name+' - Facilities Manager - Acme Offices',url:'https://linkedin.com/in/'+name.replaceAll(' ','-'),snippet:'Facilities Manager at Acme Offices'});
const input=provider=>({company:'Acme Offices',profile:{targetRoles:['Facilities Manager'],fallbackRoles:['Office Manager']},provider,timeLeftMs:()=>100000});
it('the ladder queries and judges the brand while retaining full lead context',async()=>{
 const search=vi.fn(async()=>({ok:true,hits:[{title:'Ann Roe - Founder - Cleancat',url:'https://linkedin.com/in/ann-roe',snippet:'Founder at Cleancat'}],via:'searxng'}));
 const result=await findRolePeople({...input({search}),company:'Cleancat - Commercial Cleaning Services Dublin',city:'Dublin',profile:{targetRoles:['Founder']}});
 expect(result.people).toMatchObject([{first:'Ann',last:'Roe',title:'Founder'}]);
 expect(search.mock.calls[0][0]).toBe('site:linkedin.com/in "Cleancat" ("Founder") Dublin');
});
it('stops on the first rung with a hit and saves at most two distinct people',async()=>{
 const search=vi.fn(async()=>({ok:true,hits:[hit(),hit(),hit('Ann Lee'),hit('Ben Smith')],via:'searxng'}));const result=await findRolePeople(input({search}));expect(result.people.map(p=>p.first)).toEqual(['Jane','Ann']);expect(result.searches).toBe(1);expect(search).toHaveBeenCalledTimes(1);
});
it('tries three rungs maximum',async()=>{const search=vi.fn(async()=>({ok:true,hits:[],via:'searxng'}));expect(await findRolePeople(input({search}))).toMatchObject({people:[],searches:3});expect(search).toHaveBeenCalledTimes(3)});
it('runs built-in rungs when no profile exists',async()=>{const search=vi.fn(async()=>({ok:true,hits:[],via:'searxng'}));await findRolePeople({...input({search}),profile:null});expect(search).toHaveBeenCalledTimes(2);expect(search.mock.calls[0][0]).toContain('Operations Manager');expect(search.mock.calls[1][0]).toContain('Owner')});
it.each(['limit','cap','failed'])('stops on %s and does not search later rungs',async why=>{const search=vi.fn(async()=>({ok:false,why}));expect(await findRolePeople(input({search}))).toMatchObject({people:[],stopped:why,searches:1});expect(search).toHaveBeenCalledTimes(1)});
it('stops with less than twenty seconds and skips unusable company names',async()=>{const search=vi.fn();expect(await findRolePeople({...input({search}),timeLeftMs:()=>19999})).toMatchObject({searches:0,stopped:'time'});expect(await findRolePeople({...input({search}),company:'  '})).toMatchObject({searches:0});expect(search).not.toHaveBeenCalled()});
it('fills only blank fields on an existing matching contact without changing source or enrollment',()=>{
 const existing=[{id:'contact',first_name:'Jane',last_name:'Doe',source:'companies_house',title:'',linkedin_url:'https://linkedin.com/in/existing',include_in_sequences:true}];
 expect(roleContactPlan(person,existing,{leadId:'lead',creatorId:'creator'})).toEqual({kind:'merge',contactId:'contact',patch:{title:'Facilities Manager'}});
});
it('never revives dismissed contacts or inserts a duplicate ambiguous name',()=>{
 const c={id:'one',first_name:'Jane',last_name:'Doe',dismissed_at:'2026-11-01'};expect(roleContactPlan(person,[c],{leadId:'lead',creatorId:'creator'})).toEqual({kind:'skip'});expect(roleContactPlan(person,[{...c,dismissed_at:null},{...c,id:'two',dismissed_at:null}],{leadId:'lead',creatorId:'creator'})).toEqual({kind:'skip'});
});
it('creates a role-search person without enrollment',()=>{expect(roleContactPlan(person,[],{leadId:'lead',creatorId:'creator'})).toEqual({kind:'insert',row:{lead_id:'lead',created_by:'creator',source:'role_search',kind:'person',first_name:'Jane',last_name:'Doe',title:'Facilities Manager',linkedin_url:person.linkedinUrl,include_in_sequences:false}})});
it('chooses only the lead org profile and falls back only for an unambiguous org',()=>{
 const profiles=[{id:'a',org_id:'org',target_roles:['Manager']},{id:'b',org_id:'other'}];expect(chooseRoleProfile(profiles,'org','a')).toEqual({targetRoles:['Manager'],fallbackRoles:[]});expect(chooseRoleProfile(profiles,'org','b')).toEqual({targetRoles:['Manager'],fallbackRoles:[]});expect(chooseRoleProfile([...profiles,{id:'c',org_id:'org'}],'org',null)).toBeNull();
});
it('prioritizes role-search people ahead of owners and caps officers only after a role hit',()=>{
 const people=[{first:'Owner',last:'Smith'},{first:'Jane',last:'Doe'}];expect(prioritizeRolePeople(people,[person])).toEqual([people[1],people[0]]);expect(officersForRoleSearch([1,2,3,4,5],true)).toEqual([1,2,3]);expect(officersForRoleSearch([1,2,3,4,5],false)).toEqual([1,2,3,4,5]);
});
it('drops company secretaries as people',()=>{expect(mapCompaniesHouseOfficers([{name:'DOE, Jane',officer_role:'secretary'}])).toEqual([])});
it.each([
 [{people:[person],via:['searxng']},'Role search: found 1 (Jane Doe, Facilities Manager).'],
 [{people:[],via:[]},'Role search: nobody in the target roles was found.'],
 [{people:[],via:[],stopped:'limit'},'Role search: skipped, the web search allowance for today is used up.'],
 [{people:[],via:[],stopped:'cap'},'Role search: skipped, the AI call cap was reached.'],
 [{people:[],via:[],stopped:'time'},'Role search: ran out of time.'],
 [{people:[person],via:['gemini']},'Role search: found 1 (Jane Doe, Facilities Manager). Used the backup search.'],
])('uses the exact result step line', (result,line)=>expect(roleSearchLine(result)).toBe(line));
