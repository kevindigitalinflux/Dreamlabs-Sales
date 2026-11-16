import {expect,it} from 'vitest'
import {cleanRoles,roleLadder,roleQuery,judgeRoleHit} from '../../supabase/functions/_shared/roleSearchRules'
const lead={company:'Acme Offices'},rung={rung:'target' as const,roles:['Facilities Manager']};
const hit={title:'Jane Doe - Facilities Manager - Acme Offices Ltd | LinkedIn',url:'https://uk.linkedin.com/in/jane-doe-1a2b3c/?trk=x',snippet:'Facilities Manager at Acme Offices'};
it('rejects a snippet role attached to a different organization',()=>{
 expect(judgeRoleHit({...hit,title:'Sam Lee - Acme Offices | LinkedIn',snippet:'Cleaner at Acme Offices. Director of his local football club.'},lead,{rung:'final',roles:['Director']})).toEqual({ok:false,why:'role_mismatch'});
});
it.each(['at','@',','])('saves the ladder role from same-segment snippet evidence with %s',separator=>{
 expect(judgeRoleHit({...hit,title:'Jane Doe - Titan Cleaning Services | LinkedIn',snippet:`Owner ${separator} Titan Cleaning Services · Location: Amsterdam`},{company:'Titan Cleaning Services'},{rung:'final',roles:['Owner']})).toMatchObject({ok:true,person:{title:'Owner'}});
});
it.each([
 ['Amy Poe - Managing Director - Pro Cleaning Solutions Texas | LinkedIn','Managing Director at Pro Cleaning Solutions Texas','Pro Cleaning'],
 ['John Smith - Director - Deep Cleaning Experts Ltd','','Deep Cleaning'],
])('rejects longer-named different company: %s',(title,snippet,company)=>{
 expect(judgeRoleHit({...hit,title,snippet},{company},{rung:'final',roles:['Managing Director','Director']})).toEqual({ok:false,why:'company_mismatch'});
});
it('allows legal and lead location words in company evidence',()=>{
 expect(judgeRoleHit({...hit,title:'Jane Doe - Facilities Manager - Acme Offices London UK Ltd'}, {...lead,city:'London',country:'UK'},rung)).toMatchObject({ok:true});
});
it('accepts a current right-role person and normalizes the profile URL',()=>{expect(judgeRoleHit(hit,lead,rung)).toEqual({ok:true,person:{first:'Jane',last:'Doe',title:'Facilities Manager',linkedinUrl:'https://uk.linkedin.com/in/jane-doe-1a2b3c',rung:'target'}})});
it.each(['/company/acme','/pub/dir/','/in/'])('refuses non-profile path %s',path=>{expect(judgeRoleHit({...hit,url:'https://linkedin.com'+path},lead,rung)).toEqual({ok:false,why:'not_profile_url'})});
it.each(['https://linkedin.com.attacker.test/in/person','https://attacker.linkedin.com/in/person','javascript:alert(1)'])('refuses misleading host %s',url=>{expect(judgeRoleHit({...hit,url},lead,rung)).toEqual({ok:false,why:'not_profile_url'})});
it('accepts country URLs without a scheme',()=>{expect(judgeRoleHit({...hit,url:'uk.linkedin.com/in/jane?trk=x'},lead,rung)).toMatchObject({ok:true,person:{linkedinUrl:'https://uk.linkedin.com/in/jane'}})});
it.each(['Jane','Jane Doe MBA 123','Jane Doe Junior Senior Fifth'])('refuses unparseable name %s',name=>{expect(judgeRoleHit({...hit,title:name+' - Facilities Manager - Acme Offices'},lead,rung)).toEqual({ok:false,why:'no_name'})});
it('accepts letter, apostrophe and hyphen names',()=>{expect(judgeRoleHit({...hit,title:"Mary-Jane O'Brien - Facilities Manager - Acme Offices"},lead,rung)).toMatchObject({ok:true,person:{first:'Mary-Jane',last:"O'Brien"}})});
it('rejects a different company with similar words',()=>{expect(judgeRoleHit(hit,{company:'Acme Cleaners Texas'},rung)).toEqual({ok:false,why:'company_mismatch'})});
it('requires distinctive company whole words, not substrings or legal suffixes',()=>{expect(judgeRoleHit({...hit,title:'Jane Doe - Facilities Manager - Acme OfficesExtra',snippet:''},lead,rung)).toEqual({ok:false,why:'company_mismatch'});expect(judgeRoleHit(hit,{company:'The Co Ltd'},rung)).toEqual({ok:false,why:'company_mismatch'})});
it('accepts registered name evidence and Experience snippets',()=>{expect(judgeRoleHit({...hit,title:'Jane Doe - Facilities Manager',snippet:'Experience: Acme Offices Ltd'}, {company:'Trading Brand',registeredName:'Acme Offices Ltd'},rung)).toMatchObject({ok:true})});
it('rejects a company mentioned in unrelated snippet text',()=>{expect(judgeRoleHit({...hit,title:'Jane Doe - Facilities Manager',snippet:'Sponsored event for Acme Offices'},lead,rung)).toEqual({ok:false,why:'company_mismatch'})});
it.each(['Former','Formerly','ex-','Previously','Retired','was a'])('rejects former-employment marker %s',marker=>{expect(judgeRoleHit({...hit,snippet:marker+' Facilities Manager at Acme Offices'},lead,rung)).toEqual({ok:false,why:'former'})});
it('rejects an ended year range adjacent to the company',()=>{expect(judgeRoleHit({...hit,snippet:'Experience: Acme Offices 2019 - 2022'},lead,rung)).toEqual({ok:false,why:'former'})});
it('does not treat unrelated past dates as former employment',()=>{expect(judgeRoleHit({...hit,snippet:'Founded 2019 - 2022. Facilities Manager at Acme Offices'},lead,rung)).toMatchObject({ok:true})});
it('rejects another current company in the title despite an old snippet match',()=>{expect(judgeRoleHit({...hit,title:'Jane Doe - Facilities Manager - Other Employer',snippet:'Experience: Acme Offices'},lead,rung)).toEqual({ok:false,why:'company_mismatch'})});
it('requires every role word within role title or first 160 snippet characters',()=>{expect(judgeRoleHit({...hit,title:'Jane Doe - Facility Management - Acme Offices',snippet:''},lead,rung)).toEqual({ok:false,why:'role_mismatch'});expect(judgeRoleHit({...hit,title:'Jane Doe - Assistant - Acme Offices',snippet:'x'.repeat(161)+' Facilities Manager'},lead,rung)).toEqual({ok:false,why:'role_mismatch'})});
it('cleans, deduplicates and bounds ordered roles',()=>{expect(cleanRoles([' Manager ','manager','','x','y'.repeat(61),null,'Director'])).toEqual(['Manager','Director']);expect(cleanRoles(Array.from({length:20},(_,i)=>'Role '+i))).toHaveLength(12);expect(cleanRoles('Manager')).toEqual([])});
it('provides built-in fallback then final when no profile exists',()=>{expect(roleLadder(null)).toEqual([{rung:'fallback',roles:['Operations Manager','Office Manager','Head of Operations','Executive Assistant','HR Manager']},{rung:'final',roles:['Owner','Founder','Managing Director','CEO','Director','President','General Manager']}] )});
it('keeps profile target and fallback order',()=>{expect(roleLadder({targetRoles:[' Facilities Manager '],fallbackRoles:['Office Manager']})).toMatchObject([{rung:'target',roles:['Facilities Manager']},{rung:'fallback',roles:['Office Manager']},{rung:'final'}])});
it('builds the exact query form without injected company quotes',()=>{expect(roleQuery({company:'Acme "Offices"',roles:['Facilities Manager','Office Manager'],city:'London'})).toBe('site:linkedin.com/in "Acme Offices" ("Facilities Manager" OR "Office Manager") London')});
it('limits to five roles and drops trailing roles to fit 300',()=>{const q=roleQuery({company:'Acme Offices',roles:Array.from({length:12},(_,i)=>'Role '+i+' '+'x'.repeat(50)),city:'London'});expect(q.length).toBeLessThanOrEqual(300);expect(q).not.toContain('Role 5');expect(q).toContain('Role 0')});
