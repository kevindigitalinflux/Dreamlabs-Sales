import {expect,it} from 'vitest'
import {teamPeopleFromPage,pickTeamPeople,teamPeopleForLead,shouldSearchAfterTeam,combineTeamRolePeople} from '../../supabase/functions/_shared/teamPageRules'
import {roleLadder} from '../../supabase/functions/_shared/roleSearchRules'
const page=(html:string)=>({html,url:'https://acme.test/our-team'});
const card=(name='Jane Doe',title='Facilities Manager')=>'<article class="team-card"><h3>'+name+'</h3><p>'+title+'</p><a href="https://uk.linkedin.com/in/jane/?trk=x">LinkedIn</a></article>';
it('reads JSON-LD Person objects first, including graph nodes and sameAs',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'Person',name:'Ann Lee',jobTitle:'Office Manager',sameAs:['https://linkedin.com/in/ann']}]})+'</script>'+card();
 expect(teamPeopleFromPage(page(html)).map(p=>[p.first,p.title,p.linkedinUrl])).toEqual([['Ann','Office Manager','https://linkedin.com/in/ann'],['Jane','Facilities Manager','https://uk.linkedin.com/in/jane']]);
});
it('reads name, title and LinkedIn from the same card',()=>{expect(teamPeopleFromPage(page(card()))).toEqual([{first:'Jane',last:'Doe',title:'Facilities Manager',linkedinUrl:'https://uk.linkedin.com/in/jane',sourceUrl:'https://acme.test/our-team'}])});
it('reads strong names and next-sibling titles without requiring LinkedIn',()=>{expect(teamPeopleFromPage(page('<div><strong>Mary-Jane O&apos;Brien</strong><div>Head of Operations</div></div>'))).toMatchObject([{first:'Mary-Jane',last:"O'Brien",title:'Head of Operations',linkedinUrl:null}])});
it.each(['testimonial','review','client','nav','footer'])('ignores ancestor %s sections',kind=>{expect(teamPeopleFromPage(page('<section class="'+kind+'">'+card()+'</section>'))).toEqual([])});
it.each(['We love our customers.','One two three four five six seven eight nine'])('ignores sentence titles %s',title=>{expect(teamPeopleFromPage(page(card('Jane Doe',title)))).toEqual([])});
it('rejects company-name headings',()=>{expect(teamPeopleFromPage(page('<title>Acme Offices</title>'+card('Acme Offices')))).toEqual([])});
it('deduplicates JSON-LD and cards and caps at twelve per page',()=>{expect(teamPeopleFromPage(page(Array.from({length:20},(_,i)=>card('Jane '+String.fromCharCode(65+i)+'son')).join('')))).toHaveLength(12)});
it('limits extraction to eligible paths',()=>{expect(teamPeopleFromPage({html:card(),url:'https://acme.test/contact'})).toEqual([])});
it('orders picks by rung, uses whole role words and caps at two',()=>{
 const people=teamPeopleFromPage(page(card('Owner Smith','Owner')+card('Ann Lee','Office Manager')+card('Jane Doe','Facilities Manager')+card('Wrong Person','Facility Management')));
 expect(pickTeamPeople(people,roleLadder({targetRoles:['Facilities Manager']})).map(p=>[p.first,p.rung])).toEqual([['Jane','target'],['Ann','fallback']]);
});
it('rejects unconfirmed or suspect domains and matches company names at the lead boundary',()=>{
 const pages=[page(card()),{html:card('Acme Offices'),url:'https://acme.test/team'}];
 expect(teamPeopleForLead(pages,{company:'Acme Offices',confirmedDomains:[],suspectDomains:[]})).toEqual([]);
 expect(teamPeopleForLead(pages,{company:'Acme Offices',confirmedDomains:['acme.test'],suspectDomains:['acme.test']})).toEqual([]);
 expect(teamPeopleForLead(pages,{company:'Acme Offices',confirmedDomains:['acme.test'],suspectDomains:[]})).toHaveLength(1);
});
it('skips searches only for target team hits, keeps team picks within the combined two-person cap',()=>{
 const team=pickTeamPeople(teamPeopleFromPage(page(card())),roleLadder({targetRoles:['Facilities Manager']}));expect(shouldSearchAfterTeam(team)).toBe(false);expect(shouldSearchAfterTeam([{...team[0],rung:'fallback'}])).toBe(true);
 expect(combineTeamRolePeople([{...team[0],rung:'fallback'}],[{first:'Ann',last:'Lee',title:'Office Manager',linkedinUrl:'https://linkedin.com/in/ann',rung:'fallback'},{first:'Ben',last:'Smith',title:'Director',linkedinUrl:'https://linkedin.com/in/ben',rung:'final'}]).map(p=>[p.first,p.source])).toEqual([['Jane','team_page'],['Ann','role_search']]);
});

it('keeps a nested title separate from social-link text',()=>{
 expect(teamPeopleFromPage(page('<article><h3>Jane Doe</h3><div><p>Facilities Manager</p><a href="https://linkedin.com/in/jane">LinkedIn</a></div></article>'))[0].title).toBe('Facilities Manager');
});
it('takes a LinkedIn link before the name when it belongs to the same card',()=>{
 expect(teamPeopleFromPage(page('<article><a href="https://linkedin.com/in/jane">Profile</a><h3>Jane Doe</h3><p>Facilities Manager</p></article>'))[0].linkedinUrl).toBe('https://linkedin.com/in/jane');
});
