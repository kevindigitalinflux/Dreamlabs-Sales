import {expect,it} from 'vitest';
import {teamPeopleForLead} from '../../supabase/functions/_shared/teamPageRules';
const trust={company:'Modern Mop Cleaning Services',confirmedDomains:['modernmop.test'],suspectDomains:[]};
const extract=(html:string)=>teamPeopleForLead([{html,url:'https://modernmop.test/'}],trust);
it.each([
 ['Owner, Gary Ramsay','Gary','Ramsay','Owner'],
 ['Gary Ramsay, Owner','Gary','Ramsay','Owner'],
 ['Owner: Gary Ramsay','Gary','Ramsay','Owner'],
 ['Founder - Ann Roe','Ann','Roe','Founder'],
 ["I'm Gary Ramsay and this is an owner-led company.",'Gary','Ramsay','Owner'],
 ["I'm Gary Ramsay, the founder of Modern Mop Cleaning Services.",'Gary','Ramsay','Founder'],
])('reads a trusted company page/footer pair: %s',(text,first,last,title)=>{
 expect(extract('<footer>'+text+'</footer>')).toMatchObject([{first,last,title,linkedinUrl:null}]);
});
it.each(['Owner Operated','Owners Club','said Gary Ramsay, owner of Other Co','Former Owner, Gary Ramsay','Owner, Modern Mop Cleaning Services'])('refuses non-person, former or third-party text: %s',text=>expect(extract('<p>'+text+'</p>')).toEqual([]));
it('refuses testimonial markup and untrusted domains',()=>{
 expect(extract('<section class="testimonial">Owner, Gary Ramsay</section>')).toEqual([]);
 expect(teamPeopleForLead([{html:'<footer>Owner, Gary Ramsay</footer>',url:'https://other.test/'}],trust)).toEqual([]);
});
it('keeps testimonial exclusions inside a complete document and nested footer',()=>{
 expect(extract('<html><body><footer><span class="review">Owner, Gary Ramsay</span></footer></body></html>')).toEqual([]);
});
it('uses only the supplied ladder roles',()=>{
 expect(teamPeopleForLead([{html:'<footer>Owner, Gary Ramsay</footer>',url:'https://modernmop.test/'}],{...trust,roles:['Office Manager']})).toEqual([]);
});
