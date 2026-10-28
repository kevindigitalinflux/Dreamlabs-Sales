import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunLeadGroups } from '../components/autopilot/RunLeadGroups';
import { ReadinessBadge } from '../components/pipeline/ReadinessBadge';
import { extractTeamMembers, parseLeadPersonName } from '../../supabase/functions/_shared/deepFindRules';
import { dedupeCompanyPhones } from '../../supabase/functions/_shared/phoneNumbers';
it('keeps nine needs-input rows open', () => {
 const rows=Array.from({length:9},(_,i)=>({id:String(i),status:'needs_input',reason:null,lead:null,resolution:'open'}));
 expect(renderToStaticMarkup(createElement(RunLeadGroups,{rows:rows as never,loading:false,error:null}))).toContain('aria-expanded="true"');
});
it.each(['ready','almost','needs_work',null] as const)('tints readiness %s', readiness => {
 const html=renderToStaticMarkup(createElement(ReadinessBadge,{readiness}));
 expect(html).toMatch(/bg-(?:stage-won|stage-proposal-sent|danger-strong|stage-new-lead)\/10/);
});
it.each(['Hola Amigos','Bonjour Everyone',"G’day Everyone",'Gday Everyone','Namaste Friends','Ni Hao','Aloha Everyone','Howdy Friends','Cheers Everyone','Thanks Everyone','Thank You'])('rejects %s', name => {
 expect(parseLeadPersonName(name)).toBeNull();
 expect(extractTeamMembers(`<script type="application/ld+json">${JSON.stringify({'@type':'Person',name,jobTitle:'Owner'})}</script>`)).toEqual([]);
});
it.each(['Hilary Hill','Hiroshi Tanaka'])('retains %s', name => {expect(parseLeadPersonName(name)).not.toBeNull();});
it('normalises GB national and international company phones to one proposal', () => {
 const p={name:'Jane Smith',field:'person_phone',value:'020 7946 0958',label:'Company line',phone:{kind:'company_line'}};
 expect(dedupeCompanyPhones([p,{...p,value:'+442079460958'}],'GB')).toHaveLength(1);
});
