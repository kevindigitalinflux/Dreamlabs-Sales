import { findRolePeople } from '../../supabase/functions/_shared/roleSearch';
vi.mock('../../supabase/functions/_shared/roleSearch', async original => ({...await original(), findRolePeople: vi.fn(async()=>({people:[],searches:0,via:[]}))}));
// Real engine, fake providers and a filter-aware database. No network, keys or remote writes.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/ai', async original => ({...await original(),geminiGroundedSearch:vi.fn()}));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ webSearchDomainFormat: vi.fn(async () => []), readCompanyPages: vi.fn(async () => []), webSearchForPerson: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: () => ({ search:vi.fn(async()=>({ok:false,failure:'not_configured'})),lines: () => [], verifyEmail: vi.fn(), scrapeSite: vi.fn(async () => ({ ok: false, failure: 'not_configured' })) }) }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(async () => []), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn(async () => []), fetchCompanyProfile: vi.fn() }));
import { searchCompaniesByName, fetchActiveOfficers } from '../../supabase/functions/_shared/companiesHouse';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import {geminiGroundedSearch} from '../../supabase/functions/_shared/ai';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { webSearchForPerson, readCompanyPages } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';

let lead, contacts, writes, service, deny, aiAllowed, beforeWebsiteWrite, roleProfiles, savedReadFailure, roleReadStarted;
const profile = 'https://www.linkedin.com/in/jane-smith';
const run = () => processDeepFindLead(service, { id: 'run', org_id: 'org', created_by: 'user', status: 'active' }, { id: 'result', lead_id: 'lead', org_id: 'org' });
beforeEach(() => {
  vi.clearAllMocks(); roleProfiles=[]; deny = false; aiAllowed = true; beforeWebsiteWrite = undefined;
  savedReadFailure = null; roleReadStarted = false;
  findRolePeople.mockResolvedValue({people:[],searches:0,via:[]});
  geminiGroundedSearch.mockResolvedValue({text:'',sources:[],sourceEvidence:[]});
  fetchActiveOfficers.mockResolvedValue([]);
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
  lead = { id: 'lead', org_id: 'org', business_name: 'Acme', website: 'old.com', updated_at: 'version', company_number: null, additional_websites: null };
  contacts = [{ id: 'c', lead_id: 'lead', first_name: 'Jane', last_name: 'Smith', title: 'Founder', email: 'jane@acme.com', linkedin_url: null, dismissed_at: null }];
  writes = [];
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'gemini' ? 'fake' : null);
  resolveOrgWorkerConfig.mockResolvedValue(null);
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  readCompanyPages.mockResolvedValue([]);
  webSearchForPerson.mockResolvedValue({ ok: true, found: { linkedin_url: profile }, evidence: `Jane Smith founded Acme: ${profile}` });
  lookUpPeople.mockResolvedValue({ created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] });
  service = { rpc: vi.fn(async (name) => ({ data: name === 'deep_find_reserve' ? aiAllowed : true })), from(table) {
    let patch; let inserted; const filters = [];
    const records = () => table === 'deep_find_runs' ? [{ id: 'run', org_id: 'org', status: 'active' }] : table === 'ideal_customer_profiles' ? roleProfiles : table === 'leads' ? [lead] : table === 'decision_maker_candidates' ? contacts : [];
    const result = () => {
      if (table === 'ideal_customer_profiles') roleReadStarted = true;
      if (roleReadStarted && table === savedReadFailure && !patch && !inserted) {
        savedReadFailure = null;
        return {data:null,error:{message:'fixture read failure'}};
      }
      if (table === 'leads' && patch?.website) beforeWebsiteWrite?.();
      const found = (inserted ?? records()).filter((r) => filters.every(([k,v]) => Array.isArray(r[k]) ? v === '{' + r[k].map(x => JSON.stringify(x)).join(',') + '}' : r[k] === v));
      if (patch) { writes.push({ table, patch, filters: [...filters] }); if (deny) return { data: [], error: null }; for (const row of found) { Object.assign(row, patch); if (table === 'leads') row.updated_at = 'trigger-version'; } }
      return { data: found.map((r) => ({ ...r })), count:found.length,error: null };
    };
    const q = { insert:p=>q.upsert(p),range:()=>q,gte:()=>q,order:()=>q,limit:()=>q,select: () => q, eq: (k,v) => { filters.push([k,v]); return q; }, is: (k,v) => { filters.push([k,v]); return q; },
      update: (p) => { patch = p; return q; }, upsert: (p) => { writes.push({ table, patch: p }); if(table==='decision_maker_candidates'){inserted=[];for(const row of (Array.isArray(p)?p:[p])){const saved={id:'role-'+contacts.length,dismissed_at:null,...row};contacts.push(saved);inserted.push(saved)}} return q; },
      maybeSingle: async () => { const out = result(); return { ...out, data: out.data[0] ?? null }; }, then: (resolve) => resolve(result()) };
    return q;
  } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each([false,true])('stores only fallback shape counts in the engine result, including interrupted=%s',async interrupted=>{
 const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED';
 geminiGroundedSearch.mockResolvedValue({text:JSON.stringify({title:'Some Person - Director - Acme',url:'https://linkedin.com/in/some-person',snippet:'Director at Acme'}),sources:[redirect],sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Different Person at Acme`]});
 findRolePeople.mockImplementationOnce(async input=>(await vi.importActual('../../supabase/functions/_shared/roleSearch')).findRolePeople(input));
 if(interrupted)lookUpPeople.mockRejectedValueOnce(new Error('fixture interrupted'));
 const out=await run();
 expect(out.status).toBe(interrupted?'failed':'done');
 expect(out.domains.role_search_fallback_shape).toEqual({lines_parsed:1,profile_urls:1,sources:1,redirect_sources:1,linkedin_titled_sources:1});
 expect(Object.values(out.domains.role_search_fallback_shape).every(value=>typeof value==='number')).toBe(true);
 expect(JSON.stringify(out.domains.role_search_fallback_shape)).not.toMatch(/Some|Person|Acme|https/);
});
it('passes grounded redirect evidence through the engine to an accepted role contact',async()=>{
 const redirect='https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED';
 geminiGroundedSearch.mockResolvedValue({text:JSON.stringify({title:'Ann Lee - Office Manager - Acme',url:'https://linkedin.com/in/ann-lee',snippet:'Office Manager at Acme'}),sources:[redirect],sourceEvidence:[`${redirect} linkedin.com`,`${redirect} Ann Lee is Office Manager at Acme`]});
 findRolePeople.mockImplementationOnce(async input=>(await vi.importActual('../../supabase/functions/_shared/roleSearch')).findRolePeople(input));
 const out=await run();expect(contacts.find(c=>c.first_name==='Ann')).toMatchObject({source:'role_search',title:'Office Manager',include_in_sequences:false});
 expect(out.domains).not.toHaveProperty('role_search_fallback_shape');
});
it.each(['ideal_customer_profiles','decision_maker_candidates'])('continues without role/team saves when %s cannot be read',async table=>{
 savedReadFailure=table;lead.website='https://acme.com';
 roleProfiles=[{id:'icp',org_id:'org',target_roles:['Facilities Manager']}];
 resolveOrgApiKey.mockImplementation(async(_s,_o,provider)=>['gemini','companies_house'].includes(provider)?'fake':null);
 searchCompaniesByName.mockResolvedValue([{company_number:'01234567',title:'ACME LIMITED',company_status:'active'}]);
 const officers=['Oliver Smith','Alice Jones','Ben Hall','Carol Wood'].map(name=>({first_name:name.split(' ')[0],last_name:name.split(' ')[1],title:'Director'}));
 fetchActiveOfficers.mockResolvedValue(officers);
 readCompanyPages.mockImplementationOnce(async(_url,_budget,_extra,onPage)=>{const html='<article><h3>Ann Lee</h3><p>Office Manager</p></article>';onPage(html,'https://acme.com/team');return [html]});
 findRolePeople.mockResolvedValue({people:[{first:'Beth',last:'Gray',title:'Facilities Manager',linkedinUrl:'https://linkedin.com/in/beth-gray',rung:'target'}],searches:1,via:['searxng']});
 const out=await run();
 expect(out.status).not.toBe('failed');
 expect(out.domains.steps).toContain('Role search: skipped, could not read saved data.');
 expect(contacts.filter(c=>['role_search','team_page'].includes(c.source))).toEqual([]);
 expect(contacts.filter(c=>c.source==='companies_house')).toHaveLength(4);
 expect(out.people_found).toBe(4);
});
it('keeps a nonblank website under Phase 3 policy and auto-captures LinkedIn with Undo', async () => {
  const out = await run();
  expect(lead.website).toBe('old.com');
  expect(lead.additional_websites).toBeNull();
  expect(out.domains.auto_applied).toEqual(expect.arrayContaining([
    { table: 'decision_maker_candidates', id: 'c', field: 'linkedin_url', before: null, after: profile },
  ]));
  expect(writes.find((w) => w.table === 'linkedin_contacts')).toMatchObject({ patch: { decision_maker_candidate_id: 'c', linkedin_url: profile } });
  expect(service.rpc).toHaveBeenCalledWith('deep_find_reserve', { run_id: 'run', hunter: 0, ai: 1 });
  expect(webSearchForPerson).toHaveBeenCalledTimes(1);
});
it('keeps a reachable good website and rejects weak/blocked replacement evidence', async () => {
  readCompanyPages.mockResolvedValue(['<title>Acme</title>']);
  expect((await run()).domains.auto_applied.filter((c) => c.table === 'leads')).toEqual([]);
  readCompanyPages.mockResolvedValue([]); lead.blocked_domains = ['acme.com'];
  expect((await run()).domains.auto_applied.filter((c) => c.table === 'leads')).toEqual([]);
  lead.blocked_domains = [];
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['web'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  expect((await run()).domains.auto_applied.filter((c) => c.table === 'leads')).toEqual([]);
});
it('does not record a CAS miss and does not capture an unsaved LinkedIn URL', async () => {
  deny = true; const out = await run();
  expect(out.domains.auto_applied).toEqual([]);
  expect(writes.some((w) => w.table === 'linkedin_contacts')).toBe(false);
});
it('offers low-confidence LinkedIn as reviewable evidence and leaves the contact blank', async () => {
  webSearchForPerson.mockResolvedValue({ ok: true, found: { linkedin_url: profile }, evidence: `Jane Smith works somewhere else: ${profile}` });
  const out = await run();
  expect(out.domains.suggestions).toContainEqual({ name: 'Jane Smith', field: 'linkedin_url', value: profile, label: `Jane Smith works somewhere else: ${profile}` });
  expect(contacts[0].linkedin_url).toBeNull();
});
it('searches a person-like owner name once even with duplicate founder evidence and reuses the wide search', async () => {
  lead.owner_name = 'Jane Smith'; contacts[0].title = 'Director'; contacts[0].email = null;
  lookUpPeople.mockImplementation(async (ctx) => {
    const found = await ctx.searchPerson({ first: 'Jane', last: 'Smith', title: 'Director', company: 'Acme', domains: ['acme.com'] }, 5_000);
    expect(found.found.linkedin_url).toBeNull();
    return { created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] };
  });
  const out = await run(); expect(webSearchForPerson).toHaveBeenCalledTimes(1);
  expect(out.domains.auto_applied.some((c) => c.field === 'linkedin_url')).toBe(true);
});
it('skips absent keys, exhausted AI budget, dismissed people, and saved profiles', async () => {
  resolveOrgApiKey.mockResolvedValue(null);
  expect((await run()).domains.steps).toContain('LinkedIn search skipped: no Gemini key is configured.');
  expect(webSearchForPerson).not.toHaveBeenCalled();
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'gemini' ? 'fake' : null);
  aiAllowed = false; await run(); expect(webSearchForPerson).not.toHaveBeenCalled();
  aiAllowed = true; contacts[0].dismissed_at = 'date'; await run(); expect(webSearchForPerson).not.toHaveBeenCalled();
  contacts[0].dismissed_at = null; contacts[0].linkedin_url = profile; await run(); expect(webSearchForPerson).not.toHaveBeenCalled();
});
it('keeps the final reserve and skips new searches when time is short', async () => {
  const start = Date.now(); vi.spyOn(Date, 'now').mockReturnValueOnce(start).mockReturnValue(start + 115_000);
  const out = await run(); expect(webSearchForPerson).not.toHaveBeenCalled();
  expect(out.domains.steps.join(' ')).toContain('LinkedIn search for Jane Smith skipped: not enough time left.');
  expect(out.domains.auto_applied.some((c) => c.table === 'leads')).toBe(false);
});

it('saves a blank website after the registry resolver writes first', async () => {
  lead.website = null;
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => ['gemini', 'companies_house'].includes(provider) ? 'fake' : null);
  searchCompaniesByName.mockResolvedValue([{ company_number: '01234567', title: 'ACME LIMITED', company_status: 'active' }]);
  const out = await run();
  expect(lead.company_number).toBe('01234567');
  expect(writes.find((w) => w.patch.company_number)).toBeTruthy();
  expect(lead.updated_at).toBe('trigger-version');
  expect(lead.website).toBe('https://acme.com');
  expect(out.domains.auto_applied.some((c) => c.field === 'website')).toBe(true);
});
it('explains a website compare-and-set miss', async () => {
  deny = true; lead.website = null;
  expect((await run()).domains.auto_applied).toEqual([]);
});
it('requests evidence only for owner-like searches and keeps non-owner URL results', async () => {
  contacts[0].title = 'Manager'; contacts[0].email = null;
  webSearchForPerson.mockResolvedValue({ ok: true, found: { linkedin_url: 'https://linkedin.com/in/jane-smith' } });
  lookUpPeople.mockImplementation(async (ctx) => {
    const result = await ctx.searchPerson({ first: 'Jane', last: 'Smith', title: 'Manager', company: 'Acme', domains: ['acme.com'] }, 5000);
    expect(result.found.linkedin_url).toBe('https://linkedin.com/in/jane-smith');
    return { created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] };
  });
  await run();
  expect(webSearchForPerson.mock.calls[0][0].includeEvidence).not.toBe(true);
});

it('preserves archive additions without replacing a saved website', async () => {
  lead.additional_websites = ['initial.com'];
  lookUpPeople.mockImplementation(async () => {
    lead.additional_websites = ['initial.com', 'later.com'];
    return { created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] };
  });
  const out = await run();
  expect(lead.additional_websites).toEqual(['initial.com', 'later.com']);
  const write = writes.find(w => w.patch.website);
  expect(write).toBeUndefined();
  expect(out.domains.auto_applied.filter(c => c.table === 'leads')).toHaveLength(0);
});
it('protects a concurrent website fill with an exact blank-value filter', async () => {
  lead.website = null;
  beforeWebsiteWrite = () => { lead.website = 'concurrent.com'; };
  const out = await run();
  expect(lead.website).toBe('concurrent.com');
  expect(out.domains.auto_applied.some(c => c.field === 'website')).toBe(false);
});
it('leaves historical archive entries untouched', async () => {
  lead.additional_websites = ['old.com'];
  const out = await run();
  expect(lead.additional_websites).toEqual(['old.com']);
  expect(out.domains.auto_applied.some(c => c.field === 'website')).toBe(false);
});
it('offers person/company prose without a profile on the same line for review only', async () => {
  webSearchForPerson.mockResolvedValue({ ok: true, found: { linkedin_url: profile }, evidence: 'Jane Smith founded Acme.\n' + profile });
  const out = await run();
  expect(contacts[0].linkedin_url).toBeNull();
  expect(out.domains.suggestions.some(s => s.value === profile)).toBe(true);
});

it('explains a suspect saved website without claiming it is missing', async () => {
  readCompanyPages.mockResolvedValue(['<title>Different Business</title>']);
  const out = await run();
  expect(out.domains.website_suspect).toBe(true);
  expect(out.reason).toContain("The lead's website may belong to another company, so it was not used.");
  expect(out.reason).not.toContain('This lead has no usable website.');
});
it('does not call an unreadable saved website missing', async () => {
  expect((await run()).reason).not.toContain('This lead has no usable website.');
  lead.website = null;
  expect((await run()).reason).toContain('This lead has no usable website.');
});

it('the engine merges a role-search hit into a registry contact with blanks only',async()=>{
 contacts[0].source='companies_house';contacts[0].title='';contacts[0].include_in_sequences=true;
 findRolePeople.mockResolvedValueOnce({people:[{first:'Jane',last:'Smith',title:'Facilities Manager',linkedinUrl:profile,rung:'target'}],searches:1,via:['searxng']});
 await run();expect(contacts).toHaveLength(1);expect(contacts[0]).toMatchObject({title:'Facilities Manager',linkedin_url:profile,source:'companies_house',include_in_sequences:true});
});
it('the engine stores a new role person as a non-enrolled contact and includes the found count',async()=>{
 const newProfile='https://linkedin.com/in/ann-lee';findRolePeople.mockResolvedValueOnce({people:[{first:'Ann',last:'Lee',title:'Office Manager',linkedinUrl:newProfile,rung:'target'}],searches:1,via:['searxng']});
 const out=await run();expect(contacts.find(c=>c.first_name==='Ann')).toMatchObject({source:'role_search',kind:'person',linkedin_url:newProfile,include_in_sequences:false,created_by:'user'});expect(out.people_found).toBe(1);
});
it('the engine does not revive a dismissed role-search match',async()=>{
 contacts[0].dismissed_at='2026-11-01';findRolePeople.mockResolvedValueOnce({people:[{first:'Jane',last:'Smith',title:'Facilities Manager',linkedinUrl:profile,rung:'target'}],searches:1,via:['searxng']});
 await run();expect(contacts).toHaveLength(1);expect(contacts[0].dismissed_at).toBe('2026-11-01');expect(contacts[0].linkedin_url).toBeNull();
});

it('a target team-page person saves without running the search ladder',async()=>{
 lead.website='https://acme.com';roleProfiles=[{id:'icp',org_id:'org',target_roles:['Facilities Manager']}];
 readCompanyPages.mockImplementationOnce(async(_url,_budget,_extra,onPage)=>{const html='<article><h3>Ann Lee</h3><p>Facilities Manager</p></article>';onPage(html,'https://acme.com/team');return [html]});
 const out=await run();expect(findRolePeople).not.toHaveBeenCalled();expect(contacts.find(c=>c.first_name==='Ann')).toMatchObject({source:'team_page',include_in_sequences:false,title:'Facilities Manager'});expect(out.domains.steps).toContain('Team page: found 1 (Ann Lee, Facilities Manager).');
});
it('a fallback team-page person still allows the search ladder',async()=>{
 lead.website='https://acme.com';roleProfiles=[{id:'icp',org_id:'org',target_roles:['Facilities Manager']}];
 readCompanyPages.mockImplementationOnce(async(_url,_budget,_extra,onPage)=>{const html='<article><h3>Ann Lee</h3><p>Office Manager</p></article>';onPage(html,'https://acme.com/team');return [html]});
 await run();expect(findRolePeople).toHaveBeenCalledTimes(1);expect(contacts.find(c=>c.first_name==='Ann')).toMatchObject({source:'team_page',include_in_sequences:false});
});
