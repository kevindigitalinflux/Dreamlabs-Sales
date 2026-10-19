// Real engine, fake providers and a filter-aware database. No network, keys or remote writes.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ readCompanyPages: vi.fn(async () => []), webSearchForPerson: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/googlePlacesLookup', () => ({ lookupPlaceContact: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloHunterLookup', () => ({ lookupApolloPhone: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloPeopleSearch', () => ({ searchApolloDecisionMakers: vi.fn(async () => []) }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(async () => []), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn(async () => []), fetchCompanyProfile: vi.fn() }));
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient';
import { fetchActiveOfficers } from '../../supabase/functions/_shared/companiesHouse';
import { lookupPlaceContact } from '../../supabase/functions/_shared/googlePlacesLookup';
import { lookupApolloPhone } from '../../supabase/functions/_shared/apolloHunterLookup';
import { searchApolloDecisionMakers } from '../../supabase/functions/_shared/apolloPeopleSearch';
import { searchCompaniesByName } from '../../supabase/functions/_shared/companiesHouse';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { webSearchForPerson, readCompanyPages, hunterAccount, hunterDomainList } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';

let lead, contacts, writes, service, deny, aiAllowed, beforeWebsiteWrite, worker, revoked;
const profile = 'https://www.linkedin.com/in/jane-smith';
const run = () => processDeepFindLead(service, { id: 'run', org_id: 'org', created_by: 'user', status: 'active' }, { id: 'result', lead_id: 'lead', org_id: 'org' });
beforeEach(() => {
  vi.clearAllMocks(); revoked = false;
  worker = { lines: () => [], verifyEmail: vi.fn(async () => ({ ok: false, failure: 'not_configured' })), scrapeSite: vi.fn(async () => ({ ok: false, failure: 'not_configured' })) };
  makeWorkerClient.mockReturnValue(worker);
  deny = false; aiAllowed = true; beforeWebsiteWrite = undefined;
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network'); }));
  lead = { id: 'lead', org_id: 'org', business_name: 'Acme', website: 'old.com', updated_at: 'version', company_number: null, additional_websites: null };
  contacts = [{ id: 'c', lead_id: 'lead', first_name: 'Jane', last_name: 'Smith', title: 'Founder', email: 'jane@acme.com', linkedin_url: null, dismissed_at: null }];
  writes = [];
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'gemini' ? 'fake' : null);
  resolveOrgWorkerConfig.mockResolvedValue(null);
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  readCompanyPages.mockResolvedValue([]);
  hunterAccount.mockResolvedValue({ ok: false, failure: 'network' });
  hunterDomainList.mockResolvedValue({ ok: true, emails: [], pattern: null });
  webSearchForPerson.mockResolvedValue({ ok: true, found: { linkedin_url: profile }, evidence: `Jane Smith founded Acme: ${profile}` });
  lookUpPeople.mockResolvedValue({ created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] });
  service = { rpc: vi.fn(async (name) => ({ data: name === 'deep_find_reserve' ? aiAllowed : !revoked })), from(table) {
    let patch, additions; const filters = [];
    const records = () => table === 'deep_find_runs' ? [{ id: 'run', org_id: 'org', status: 'active' }] : table === 'leads' ? [lead] : table === 'decision_maker_candidates' ? contacts : [];
    const result = () => {
      if (additions) {
        const input = Array.isArray(additions) ? additions : [additions];
        writes.push({ table, patch: input });
        const inserted = table === 'decision_maker_candidates' ? input.filter(p => !contacts.some(c => p.apollo_person_id && p.apollo_person_id === c.apollo_person_id)).map((p,i) => ({ id: 'new' + (contacts.length + i), dismissed_at: null, ...p })) : [];
        if (!deny) contacts.push(...inserted);
        return { data: deny ? [] : inserted.map(r => ({ ...r })), error: null };
      }
      if (table === 'leads' && patch?.website) beforeWebsiteWrite?.();
      const found = records().filter((r) => filters.every(([k,v]) => Array.isArray(r[k]) ? v === '{' + r[k].map(x => JSON.stringify(x)).join(',') + '}' : r[k] === v));
      if (patch) { writes.push({ table, patch, filters: [...filters] }); if (deny) return { data: [], error: null }; for (const row of found) { Object.assign(row, patch); if (table === 'leads') row.updated_at = 'trigger-version'; } }
      return { data: found.map((r) => ({ ...r })), error: null };
    };
    const q = { select: () => q, eq: (k,v) => { filters.push([k,v]); return q; }, is: (k,v) => { filters.push([k,v]); return q; },
      update: (p) => { patch = p; return q; }, upsert: (p) => { additions = p; return q; }, insert: (p) => { additions = p; return q; },
      maybeSingle: async () => { const out = result(); return { ...out, data: out.data[0] ?? null }; }, then: (resolve) => resolve(result()) };
    return q;
  } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('discovers Places website and phone before searching a name-only lead, recording Undo', async () => {
  lead.website = null; lead.phone = null;
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'google_places' ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ website: 'https://acme.com', phone: '+441234567890' });
  const out = await run();
  expect(lookupPlaceContact).toHaveBeenCalledWith('Acme', null, 'fake');
  expect(discoverLeadDomains.mock.calls[0][1].website).toBe('https://acme.com');
  expect(out.domains.auto_applied).toEqual(expect.arrayContaining([
    { table: 'leads', id: 'lead', field: 'phone', before: null, after: '+441234567890' },
    { table: 'leads', id: 'lead', field: 'website', before: null, after: 'https://acme.com' },
  ]));
});
it('keeps Apollo company phone reviewable, never overwrites a saved phone', async () => {
  lead.phone = null;
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'apollo' ? 'fake' : null);
  lookupApolloPhone.mockResolvedValue('+441234567890');
  const out = await run();
  expect(searchApolloDecisionMakers).toHaveBeenCalledWith('acme.com', 'fake', 3);
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'phone', value: '+441234567890' }));
  expect(lead.phone).toBeNull();
  lead.phone = 'saved'; lookupApolloPhone.mockClear(); await run();
  expect(lookupApolloPhone).not.toHaveBeenCalled();
});
it('uses only blank-field auto-apply for the confirmed website', async () => {
  const out = await run();
  expect(lead.website).toBe('old.com');
  expect(out.domains.auto_applied.some(c => c.field === 'website')).toBe(false);
});

it.each(['valid', 'risky', 'unverifiable', 'invalid'])('checker verdict %s controls wide-lookup email fills and Undo', async (status) => {
  contacts[0].email = null; contacts[0].include_in_sequences = true;
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status, reason: 'test' } });
  // No domains during guessing: the real engine's wide-lookup callback alone owns this proposal.
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [], notes: [], problems: [], sitePages: [] });
  lookUpPeople.mockImplementation(async (ctx) => {
    const result = await ctx.saveContact(contacts[0], { email: 'jane@acme.com' });
    return { created: [], touched: result ? [result] : [], emailsFound: result ? 1 : 0, suggestions: [], problems: [], results: [] };
  });
  const out = await run();
  expect(contacts[0].email).toBe(status === 'valid' ? 'jane@acme.com' : null);
  expect(out.domains.auto_applied.filter(c => c.field === 'email')).toHaveLength(status === 'valid' ? 1 : 0);
  if (status === 'valid') expect(contacts[0].include_in_sequences).toBe(false);
  else expect(out.domains.suggestions.some(s => s.value === 'jane@acme.com')).toBe(status !== 'invalid');
});
it('auto-applies own-site founder name and blank title, but never a web-only role', async () => {
  lead.owner_name = null; contacts[0].title = null;
  const html = '<script type="application/ld+json">{"@type":"Person","name":"Jane Smith","jobTitle":"Founder"}</script>';
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [{ domain: 'acme.com', pages: [html] }] });
  const out = await run();
  expect(lead.owner_name).toBe('Jane Smith'); expect(contacts[0].title).toBe('Founder');
  expect(out.domains.auto_applied.filter(c => c.field === 'owner_name' || c.field === 'title')).toHaveLength(2);
  lead.owner_name = null; contacts[0].title = 'Sales manager';
  await run(); expect(contacts[0].title).toBe('Sales manager');
  lead.owner_name = null;
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [{ name: 'Jane Smith', role: 'Founder' }], notes: [], problems: [], sitePages: [] });
  await run(); expect(lead.owner_name).toBeNull();
});
it('keeps plain registry directors as owner proposals, not automatic ownership', async () => {
  lead.owner_name = null; lead.company_number = '01234567';
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  fetchActiveOfficers.mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: 'Director' }]);
  const out = await run();
  expect(lead.owner_name).toBeNull();
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'owner_name', value: 'Jane Smith' }));
});
it('retains earlier automatic changes and Undo when access is revoked later', async () => {
  lead.website = null; lead.phone = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'google_places' ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ website: 'https://acme.com', phone: '123456789' });
  discoverLeadDomains.mockImplementation(async () => { revoked = true; throw new Error('provider failed'); });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const out = await run();
  expect(out.status).toBe('failed'); expect(out.domains.auto_applied).toHaveLength(2);
  expect(log.mock.calls.flat().join(' ')).not.toContain('provider failed');
});

it('keeps Apollo obfuscation, follows the 3-person limit, and never resets an already revealed candidate', async () => {
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'apollo' ? 'fake' : null);
  contacts.push({ id: 'revealed', lead_id: 'lead', apollo_person_id: 'existing', email: 'paid@acme.com', email_revealed: true, linkedin_url: profile, dismissed_at: null });
  searchApolloDecisionMakers.mockResolvedValue([
    { apolloPersonId: 'existing', firstName: 'Jane', lastNameObfuscated: 'S***', title: 'Founder' },
    { apolloPersonId: 'fresh', firstName: 'Mark', lastNameObfuscated: 'J***', title: 'CEO' },
  ]);
  const out = await run();
  expect(searchApolloDecisionMakers).toHaveBeenCalledWith('acme.com','fake',3);
  expect(contacts.find(c => c.id === 'revealed').email).toBe('paid@acme.com');
  expect(contacts.find(c => c.apollo_person_id === 'fresh')).toMatchObject({ name_obfuscated: true, email_revealed: false, include_in_sequences: false });
  expect(out.people_found).toBe(1);
});
it('reuses guarded Hunter lists and checks new contact addresses before blank fills', async () => {
  contacts = [];
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'hunter' ? 'fake' : null);
  hunterDomainList.mockResolvedValue({ ok: true, emails: [
    { first_name: 'Jane', last_name: 'Smith', position: 'Founder', value: 'jane@acme.com' },
    { first_name: 'John', last_name: 'Jones', position: 'CEO', value: 'john@acme.com' },
  ], pattern: null });
  worker.verifyEmail.mockImplementation(async (email) => ({ ok: true, value: { status: email.startsWith('jane') ? 'valid' : 'risky', reason: 'test' } }));
  const out = await run();
  expect(hunterDomainList).toHaveBeenCalledOnce();
  expect(service.rpc).toHaveBeenCalledWith('deep_find_reserve', { run_id: 'run', hunter: 1, ai: 0 });
  expect(contacts.find(c => c.first_name === 'Jane').email).toBe('jane@acme.com');
  expect(contacts.find(c => c.first_name === 'John').email).toBeNull();
  expect(out.domains.auto_applied.filter(c => c.field === 'email')).toHaveLength(1);
  expect(out.domains.suggestions.some(s => s.value === 'john@acme.com')).toBe(true);
});
it('starts no Hunter list request when the existing run cap refuses a reservation', async () => {
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'hunter' ? 'fake' : null); aiAllowed = false;
  await run(); expect(hunterDomainList).not.toHaveBeenCalled();
});
it('records registry owner-like name/title fills and respects dismissed ownership', async () => {
  lead.owner_name = null; lead.company_number = '01234567'; contacts[0].title = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  fetchActiveOfficers.mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: 'Founder' }]);
  const out = await run();
  expect(out.domains.auto_applied.filter(c => ['owner_name','title'].includes(c.field))).toHaveLength(2);
  lead.owner_name = null; lead.dismissed_suggestions = ['owner_name:jane smith'];
  await run(); expect(lead.owner_name).toBeNull();
});
it('does not build guesses or search LinkedIn for Apollo obfuscated names', async () => {
  contacts = [{ id: 'c', first_name: 'Jane', last_name: 'S', name_obfuscated: true, title: 'CEO', email: null }];
  await run();
  expect(lookUpPeople.mock.calls[0][0].people).toEqual([]);
  expect(webSearchForPerson).not.toHaveBeenCalled();
});
