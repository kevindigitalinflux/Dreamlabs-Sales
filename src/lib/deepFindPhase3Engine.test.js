import { cachedMailProvider } from '../../supabase/functions/_shared/dnsLookup';
vi.mock('../../supabase/functions/_shared/dnsLookup', () => ({ cachedMailProvider: vi.fn(() => 'unknown'), lookupMx: vi.fn(async () => 'mx') }));
// Real engine, fake providers and a filter-aware database. No network, keys or remote writes.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ webSearchDomainFormat: vi.fn(async () => []), readCompanyPages: vi.fn(async () => []), webSearchForPerson: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/openCorporates', () => ({ lookupOpenCorporatesOfficer: vi.fn(async () => null) }));
vi.mock('../../supabase/functions/_shared/registryWebProof', () => ({ registryWebNumbers: vi.fn(async () => []) }));
vi.mock('../../supabase/functions/_shared/googlePlacesLookup', () => ({ lookupPlaceContact: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloHunterLookup', () => ({ lookupApolloPhone: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloPeopleSearch', () => ({ searchApolloDecisionMakers: vi.fn(async () => []) }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(async () => []), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn(async () => []), fetchCompanyProfile: vi.fn() }));
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient';
import { fetchCompanyProfile, fetchActiveOfficers } from '../../supabase/functions/_shared/companiesHouse';
import { lookupPlaceContact } from '../../supabase/functions/_shared/googlePlacesLookup';
import { lookupApolloPhone } from '../../supabase/functions/_shared/apolloHunterLookup';
import { searchApolloDecisionMakers } from '../../supabase/functions/_shared/apolloPeopleSearch';
import { searchCompaniesByName } from '../../supabase/functions/_shared/companiesHouse';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { webSearchDomainFormat, webSearchForPerson, readCompanyPages, hunterAccount, hunterDomainList, hunterVerifyEmail } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';
import { lookupOpenCorporatesOfficer } from '../../supabase/functions/_shared/openCorporates';
import { registryWebNumbers } from '../../supabase/functions/_shared/registryWebProof';
import { undoDeepFindChange } from './deepFindReview';

let lead, contacts, writes, service, deny, aiAllowed, beforeWebsiteWrite, worker, revoked;
const profile = 'https://www.linkedin.com/in/jane-smith';
const run = (effort) => processDeepFindLead(service, { id: 'run', org_id: 'org', created_by: 'user', status: 'active' }, { id: 'result', lead_id: 'lead', org_id: 'org', domains: effort ? { effort } : {} });
it('Medium on Microsoft 365 offers one most likely unverified address without any email write', async () => {
  contacts[0].email = null;
  cachedMailProvider.mockReturnValue('microsoft');
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'unverifiable', reason: 'provider_blocked' } });
  const out = await run('medium');
  expect(out.status).toBe('done');
  expect(out.domains.suggestions.filter(s => s.guess_rank === 'most_likely')).toEqual([
    expect.objectContaining({ value: 'jane.smith@acme.com', label: expect.stringContaining('unverified') }),
  ]);
  expect(out.domains.steps.join(' ')).toContain('Microsoft 365');
  expect(writes.some(w => 'email' in w.patch)).toBe(false);
  expect(webSearchDomainFormat).not.toHaveBeenCalled();
});
it.each(['high', 'extra_high'])('%s uses one reserved grounded format search after free checks', async effort => {
  contacts[0].email = null;
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: false, failure: 'unreachable' });
  webSearchDomainFormat.mockResolvedValue([{ email: 'jane@acme.com', first: null, last: null }]);
  const out = await run(effort);
  expect(webSearchDomainFormat).toHaveBeenCalledTimes(1);
  expect(out.domains.credits.ai['public email format']).toBe(1);
  expect(out.domains.suggestions.find(s => s.guess_rank === 'most_likely')?.value).toBe('jane@acme.com');
  expect(worker.verifyEmail).toHaveBeenCalled();
  expect(writes.some(w => 'email' in w.patch)).toBe(false);
});
it('a free verified address suppresses Hunter company lists and public format search', async () => {
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => ['gemini', 'hunter'].includes(provider) ? 'fake' : null);
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  await run('extra_high');
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(webSearchDomainFormat).not.toHaveBeenCalled();
});
it('middle-name display matching cannot authorize automatic owner or title writes', async () => {
  contacts[0].title = null;
  contacts[0].email = null;
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [{ domain: 'acme.com', pages: ['<p>Jane Middle Smith, Founder</p>'] }] });
  const out = await run('low');
  expect(out.status).toBe('done');
  expect(writes.some(w => 'owner_name' in w.patch || 'title' in w.patch)).toBe(false);
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'owner_name', value: 'Jane Middle Smith' }));
});
beforeEach(() => {
  vi.clearAllMocks(); revoked = false;
  cachedMailProvider.mockReturnValue('unknown');
  webSearchDomainFormat.mockResolvedValue([]);
  fetchActiveOfficers.mockResolvedValue([]);
  searchCompaniesByName.mockResolvedValue([]);
  registryWebNumbers.mockResolvedValue([]);
  checkRateLimit.mockImplementation(async () => true);
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
it('UKRM keeps one ranked suggestion per director after two invalid checks and one unverifiable result', async () => {
  lead.business_name = 'UKRM'; lead.website = null;
  contacts = [
    { id: 'one', lead_id: 'lead', first_name: 'Karthik', last_name: 'Rao', source: 'companies_house', title: 'Director', email: null },
    { id: 'two', lead_id: 'lead', first_name: 'Ravi', last_name: 'Kumar', source: 'companies_house', title: 'Director', email: null },
  ];
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'ukrmanagement.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  resolveOrgWorkerConfig.mockResolvedValue({});
  let count = 0;
  worker.verifyEmail.mockImplementation(async () => ({ ok: true, value: ++count < 3 ? { status: 'invalid', reason: 'mailbox_missing' } : { status: 'unverifiable', reason: 'unknown' } }));
  const out = await run('low');
  expect(worker.verifyEmail).toHaveBeenCalledTimes(3);
  expect(out.domains.suggestions.filter(s => s.guess_rank === 'most_likely').map(s => s.name).sort()).toEqual(['Karthik Rao', 'Ravi Kumar']);
  expect(contacts.every(c => !c.email)).toBe(true);
});
it('reports dismissed contacts and owner/person keys while skipping their checks and lookups', async () => {
  contacts[0].email = null; contacts[0].dismissed_at = 'yesterday';
  lead.additional_owners = ['Ravi Kumar', 'Karthik Rao'];
  lead.dismissed_suggestions = ['owner:ravi kumar', 'person:karthik rao'];
  const out = await run('low');
  expect(out.domains.dismissed_people).toEqual(expect.arrayContaining([
    { name: 'Jane Smith', contact_id: 'c' }, { name: 'Ravi Kumar' }, { name: 'Karthik Rao' },
  ]));
  expect(out.domains.steps).toContain('Jane Smith was dismissed earlier, so Deep find skipped them. Restore them from the lead page.');
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(lookUpPeople.mock.calls[0][0].people).toEqual([]);
});
it('keeps full-name owner dismissals effective after the lookup parser removes middle names', async () => {
  contacts = [];
  lead.owner_name = 'Karthik Middle Rao';
  lead.dismissed_suggestions = ['owner:karthik middle rao'];
  const out = await run('low');
  expect(out.domains.dismissed_people).toContainEqual({ name: 'Karthik Middle Rao' });
  expect(lookUpPeople.mock.calls[0][0].people).toEqual([]);
  expect(out.domains.suggestions).toEqual([]);
});
it('offers ranked addresses even for known people beyond the five-person lookup cap', async () => {
  contacts = ['Jane', 'Alex', 'Alice', 'Ravi', 'Karthik', 'Sarah'].map((first_name, i) => ({ id: 'c' + i, lead_id: 'lead', first_name, last_name: 'Smith', email: null }));
  const out = await run('low');
  expect(out.domains.suggestions.filter(s => s.guess_rank === 'most_likely')).toHaveLength(6);
  expect(out.domains.suggestions.filter(s => s.guess_rank === 'other').length).toBeLessThanOrEqual(12);
  for (const person of contacts) expect(out.domains.suggestions.filter(s => s.name === person.first_name + ' Smith' && s.guess_rank === 'other').length).toBeLessThanOrEqual(2);
});
it('bounds dismissed_people to ten and skip steps to three plus a summary', async () => {
  contacts = ['Jane', 'Alex', 'Alice', 'Ravi', 'Karthik', 'Sarah', 'Tom', 'David', 'Mary', 'Simon', 'Robert'].map((first_name, i) => ({ id: 'c' + i, lead_id: 'lead', first_name, last_name: 'Smith', email: null, dismissed_at: 'yesterday' }));
  const out = await run('low');
  expect(out.domains.dismissed_people).toHaveLength(10);
  expect(out.domains.steps.filter(s => s.includes('was dismissed earlier'))).toHaveLength(3);
  expect(out.domains.steps).toContain('and 8 more people were dismissed earlier.');
  expect(out.domains.steps.join(' ')).not.toContain('Use Start fresh');
});
it('skips guess verification for Google and Microsoft while retaining ranked proposals', async () => {
  for (const provider of ['google', 'microsoft']) {
    cachedMailProvider.mockReturnValue(provider);
    contacts[0].email = null;
    resolveOrgWorkerConfig.mockResolvedValue({});
    const out = await run('low');
    expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ name: 'Jane Smith', guess_rank: 'most_likely' }));
  }
  expect(worker.verifyEmail).not.toHaveBeenCalled();
});
it('caps concurrent guesses at 20 seconds and leaves time for both people lookups', async () => {
  vi.useFakeTimers();
  contacts[0].email = null;
  contacts.push({ id: 'two', lead_id: 'lead', first_name: 'Alex', last_name: 'Brown', email: null });
  resolveOrgWorkerConfig.mockResolvedValue({});
  let active = 0, peak = 0;
  worker.verifyEmail.mockImplementation(async (_email, { timeoutMs }) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, timeoutMs));
    active--;
    return { ok: true, value: { status: 'invalid', reason: 'mailbox_missing' } };
  });
  const pending = run('low');
  await vi.advanceTimersByTimeAsync(20_000);
  const out = await pending;
  expect(peak).toBe(3);
  expect(worker.verifyEmail.mock.calls.every(([, opts]) => opts.timeoutMs <= 12_000)).toBe(true);
  expect(lookUpPeople.mock.calls[0][0].people).toHaveLength(2);
  expect(lookUpPeople.mock.calls[0][0].left()).toBe(50_000);
  expect(out.domains.steps.join(' ')).toContain('20 second limit');
  expect(out.domains.suggestions.filter(s => s.guess_rank === 'most_likely')).toHaveLength(2);
  vi.useRealTimers();
});
it('Low disables paid discovery, Hunter, AI, Apollo, Places and LinkedIn even with every key', async () => {
  resolveOrgApiKey.mockImplementation(async (_s, _o, p) => p === 'companies_house' ? null : 'fake');
  lead.phone = null;
  const out = await run('low');
  expect(discoverLeadDomains.mock.calls[0][2].allow).toMatchObject({ hunter: false, web: false, apollo: false });
  expect(hunterAccount).not.toHaveBeenCalled();
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(webSearchForPerson).not.toHaveBeenCalled();
  expect(searchApolloDecisionMakers).not.toHaveBeenCalled();
  expect(lookupPlaceContact).not.toHaveBeenCalled();
  expect(service.rpc.mock.calls.filter(([name]) => name === 'deep_find_reserve')).toHaveLength(0);
  expect(out.domains.effort).toBe('low');
  expect(out.domains.steps.join(' ')).toContain('Low effort');
});
it('Medium runs free checks before deciding and skips deep work when the checker confirms an existing email', async () => {
  resolveOrgApiKey.mockImplementation(async (_s, _o, p) => p === 'companies_house' ? null : 'fake');
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  const out = await run('medium');
  expect(worker.verifyEmail).toHaveBeenCalledWith('jane@acme.com');
  expect(out.domains.steps.join(' ')).toContain('deeper steps were skipped');
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(webSearchForPerson).not.toHaveBeenCalled();
});
it('Medium deepens when an existing email is unverified and retains metadata on failure', async () => {
  const out = await run('medium');
  expect(out.domains.steps.join(' ')).toContain('deeper steps ran');
  expect(out.domains.effort).toBe('medium');
});
it.each([['medium', 1, 2], ['high', 3, 4], ['extra_high', 6, 8]])('%s enforces per-lead credits across all phases', async (effort, hunter, ai) => {
  resolveOrgApiKey.mockImplementation(async (_s, _o, p) => ['hunter', 'gemini'].includes(p) ? 'fake' : null);
  const result = () => ({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  let freeFinished = false;
  discoverLeadDomains.mockImplementation(async (_service, _lead, options) => {
    if (!options.allow.hunter) { freeFinished = true; return result(); }
    expect(freeFinished).toBe(true);
    expect(worker.verifyEmail).toHaveBeenCalled();
    for (let i = 0; i < 12; i++) { await options.guard.hunter(); await options.guard.ai(); }
    return result();
  });
  const out = await run(effort);
  expect(out.status).toBe('done');
  const reservations = service.rpc.mock.calls.filter(([name]) => name === 'deep_find_reserve').map(([,args]) => args);
  expect(reservations.reduce((sum, r) => sum + r.hunter, 0)).toBe(hunter);
  expect(reservations.reduce((sum, r) => sum + r.ai, 0)).toBe(ai);
});
it('preserves effort and earlier automatic changes when later deep work fails', async () => {
  lead.website = null;
  discoverLeadDomains.mockResolvedValueOnce({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] })
    .mockRejectedValueOnce(new Error('private payload'));
  const out = await run('medium');
  expect(out.status).toBe('failed');
  expect(out.domains.effort).toBe('medium');
  expect(out.domains.auto_applied).toContainEqual(expect.objectContaining({ field: 'website', after: 'https://acme.com' }));
  expect(out.domains.steps.join(' ')).toContain('Medium effort');
});
it('records a blank company match with Undo and never restores the undone number', async () => {
  lead.business_name = 'Acme'; lead.city = 'London'; lead.dismissed_suggestions = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  searchCompaniesByName.mockResolvedValue([{ company_number: '13550006', title: 'ACME LIMITED', company_status: 'active', address: { locality: 'Manchester' } }]);
  readCompanyPages.mockResolvedValue(['<title>Acme</title><footer>Registered company number 13550006</footer>']);
  const out = await run('low');
  expect(out.domains.registry_evidence['13550006']).toMatchObject({ E1: true, E2: false, E3: true });
  const change = out.domains.auto_applied.find(c => c.field === 'company_number');
  expect(change).toMatchObject({ before: null, after: '13550006' });
  expect(await undoDeepFindChange(service, 'user', 'lead', change)).toBe('Undone.');
  expect(lead.company_number).toBeNull();
  await run('low');
  expect(lead.company_number).toBeNull();
});
it('High spends one guarded AI call on grounded registry proof after free evidence remains ambiguous', async () => {
  lead.company_number = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['companies_house', 'gemini'].includes(p) ? 'fake' : null);
  searchCompaniesByName.mockResolvedValue([{ company_number: '13550006', title: 'ACME PROPERTY LIMITED', company_status: 'active', address: { locality: 'Manchester' } }]);
  readCompanyPages.mockResolvedValue(['<title>Acme</title><footer>Registered company number 13550006</footer>']);
  registryWebNumbers.mockResolvedValue(['13550006']);
  const out = await run('high');
  expect(out.status).toBe('done');
  expect(registryWebNumbers).toHaveBeenCalledTimes(1);
  expect(out.domains.registry_evidence['13550006']).toMatchObject({ E1: false, E3: true, E5: true });
  expect(out.domains.company_number).toBe('13550006');
  expect(out.domains.credits.ai['company registry proof']).toBe(1);
});
it('High deepens for a missing confirmed website; Extra high deepens for complete leads', async () => {
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [], notes: [], problems: [], sitePages: [] });
  expect((await run('high')).domains.steps.join(' ')).toContain('a confirmed website');
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  expect((await run('extra_high')).domains.steps.join(' ')).toContain('regardless');
});
it('uses Places after discovery and records safe city-matched fills with Undo', async () => {
  lead.website = null; lead.phone = null; lead.city = 'London';
  resolveOrgApiKey.mockImplementation(async (_s, _o, provider) => provider === 'google_places' ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ website: 'https://acme.com', phone: '+441234567890', strength: 2, cityMatches: true });
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [], notes: [], problems: [], sitePages: [] });
  const out = await run();
  expect(lookupPlaceContact).toHaveBeenCalledWith('Acme', 'London', 'fake');
  expect(discoverLeadDomains.mock.calls[0][1].website).toBeNull();
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
  expect(out.status).toBe('failed'); expect(out.domains.auto_applied).toHaveLength(0);
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
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ name: 'John Jones', value: 'john@acme.com' }));
  expect(out.domains.suggestions.some(s => s.name === 'Company contact' && ['jane@acme.com', 'john@acme.com'].includes(s.value))).toBe(false);
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
it.each([[null, 2, true], ['London', 1, true], ['London', 2, false]])('keeps weak Places matches reviewable city=%s strength=%s cityMatch=%s', async (city, strength, cityMatches) => {
  lead.website = null; lead.phone = null; lead.city = city;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'google_places' ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ website: 'https://murphys.com', phone: '+442079460958', name: "Murphy\'s Bar", address: 'London, UK', strength, cityMatches });
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [], notes: [], problems: [], sitePages: [] });
  const out = await run();
  expect(lead.website).toBeNull(); expect(lead.phone).toBeNull();
  expect(out.domains.suggestions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'phone', label: expect.stringContaining('London, UK') }), expect.objectContaining({ field: 'website', label: expect.stringContaining('Murphy') })]));
});
it('prefers confirmed own-site website over Places', async () => {
  lead.website = null; lead.phone = null; lead.city = 'London';
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'google_places' ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ website: 'https://wrong.com', phone: '+442079460958', strength: 2, cityMatches: true });
  await run(); expect(lead.website).toBe('https://acme.com');
});
it('enforces provider caps across repeated leads', async () => {
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['google_places','apollo'].includes(p) ? 'fake' : null);
  const counts = new Map([['places-lookups:org',299],['apollo-company-phone:org',99]]);
  checkRateLimit.mockImplementation(async (_s,key,cap,minutes,closed) => {
    expect(minutes).toBe(1440); expect(closed).toBe(true);
    const n = counts.get(key) ?? 0; if (n >= cap) return false; counts.set(key,n+1); return true;
  });
  lookupPlaceContact.mockResolvedValue(null); lookupApolloPhone.mockResolvedValue('+442079460958');
  await run(); const out = await run();
  expect(lookupPlaceContact).toHaveBeenCalledTimes(1); expect(lookupApolloPhone).toHaveBeenCalledTimes(1);
  expect(out.domains.steps).toContain("Apollo company phone lookups reached today's limit for this organisation.");
  expect(out.domains.steps).toContain("Google Places lookups reached today's limit for this organisation.");
});
it('skips phone providers when Places supplies a phone or the lead already has one', async () => {
  lead.city = 'London'; lead.website = null; lead.phone = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['google_places','apollo'].includes(p) ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ phone: '+442079460958', strength: 2, cityMatches: true });
  await run(); expect(lookupApolloPhone).not.toHaveBeenCalled();
  await run(); expect(lookupPlaceContact).toHaveBeenCalledOnce();
});
it('Undo suppresses an automatic website on a rerun', async () => {
  lead.website = null; lead.dismissed_suggestions = ['person:other person'];
  const out = await run(); const change = out.domains.auto_applied.find(c => c.field === 'website');
  expect(await undoDeepFindChange(service, 'user', 'lead', change)).toBe('Undone.');
  expect(lead.dismissed_suggestions).toEqual(['person:other person', 'website:acme.com']);
  await run(); expect(lead.website).toBeNull();
});
it.each(['website', 'phone', 'owner_name', 'email', 'title', 'linkedin_url'])('honours dismissals for automatic %s', async field => {
  lead.website = null; lead.phone = null; lead.owner_name = null; lead.city = 'London'; contacts[0].title = null; contacts[0].email = null;
  const keys = { website: 'website:acme.com', phone: 'phone:442079460958', owner_name: 'owner:jane smith', email: 'email:jane@acme.com', title: 'title:jane smith', linkedin_url: 'linkedin:' + profile };
  lead.dismissed_suggestions = [keys[field]];
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['google_places','gemini'].includes(p) ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ phone: '+442079460958', strength: 2, cityMatches: true });
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid' } });
  const html = '<script type="application/ld+json">{"@type":"Person","name":"Jane Smith","jobTitle":"Founder"}</script>';
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [{ domain: 'acme.com', pages: [html] }] });
  lookUpPeople.mockImplementation(async ctx => { await ctx.saveContact(contacts[0], { email: 'jane@acme.com' }); return { created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] }; });
  const out = await run(); expect(out.domains.auto_applied.some(c => c.field === field)).toBe(false);
});
it.each(['J', 'Jan'])('leaves incomplete owner match %s as a suggestion', async first => {
  lead.owner_name = null; contacts[0].first_name = first; contacts[0].title = null;
  const html = '<script type="application/ld+json">{"@type":"Person","name":"Jane Smith","jobTitle":"Founder"}</script>';
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [{ domain: 'acme.com', pages: [html] }] });
  const out = await run(); expect(lead.owner_name).toBeNull(); expect(contacts[0].title).toBeNull();
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'owner_name', value: 'Jane Smith' }));
});
it.each(['phone', 'owner_name', 'email', 'title', 'linkedin_url'])('Undo suppresses automatic %s and preserves existing dismissal keys', async field => {
  lead.phone = null; lead.city = 'London'; lead.owner_name = null; lead.dismissed_suggestions = ['person:someone else'];
  contacts[0].email = null; contacts[0].title = null;
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid' } });
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['google_places','gemini'].includes(p) ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ phone: '+442079460958', strength: 2, cityMatches: true });
  const html = '<script type="application/ld+json">{"@type":"Person","name":"Jane Smith","jobTitle":"Founder"}</script>';
  discoverLeadDomains.mockResolvedValue({ domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [{ domain: 'acme.com', pages: [html] }] });
  lookUpPeople.mockImplementation(async ctx => { await ctx.saveContact(contacts[0], { email: 'jane@acme.com' }); return { created: [], touched: [], emailsFound: 0, suggestions: [], problems: [], results: [] }; });
  const out = await run(); const change = out.domains.auto_applied.find(c => c.field === field);
  expect(change).toBeDefined();
  expect(await undoDeepFindChange(service, 'user', 'lead', change)).toBe('Undone.');
  expect(lead.dismissed_suggestions).toContain('person:someone else');
  await run();
  expect((field === 'phone' || field === 'owner_name' ? lead : contacts[0])[field]).toBeNull();
});
it('honours a dismissal added while discovery was running', async () => {
  lead.website = null; lead.dismissed_suggestions = [];
  discoverLeadDomains.mockImplementationOnce(async () => {
    lead.dismissed_suggestions = ['website:acme.com'];
    return { domains: [{ domain: 'acme.com', sources: ['site_confirms'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] };
  });
  await run(); expect(lead.website).toBeNull();
});
it('restores the concurrent website change notice', async () => {
  lead.website = null; beforeWebsiteWrite = () => { lead.website = 'human.com'; };
  const out = await run();
  expect(out.domains.steps).toContain('The saved website changed while Deep find ran, so it was left as is.');
});
it('logs a safe error class and message without provider payload', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  discoverLeadDomains.mockRejectedValueOnce(new TypeError('private payload https://provider.example?key=do-not-log'));
  await run();
  expect(log.mock.calls.flat()).toContain('TypeError');
  expect(log.mock.calls.flat().join(' ')).not.toContain('private payload');
  expect(log.mock.calls.flat().join(' ')).not.toContain('do-not-log');
});
it.each(['2010-2024', '2023-10-19', 'Company No. 12345678', '+11111111111'])('rejects invalid Places and Apollo phone %s', async phone => {
  lead.phone = null; lead.city = 'London';
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => ['google_places','apollo'].includes(p) ? 'fake' : null);
  lookupPlaceContact.mockResolvedValue({ phone, strength: 2, cityMatches: true }); lookupApolloPhone.mockResolvedValue(phone);
  const out = await run();
  expect(lead.phone).toBeNull(); expect(out.domains.suggestions.some(s => s.field === 'phone')).toBe(false);
});
it('does not insert dismissed provider titles on new contacts', async () => {
  contacts = []; lead.company_number = '01234567'; lead.dismissed_suggestions = ['title:jane smith'];
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  fetchActiveOfficers.mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: 'Founder' }]);
  await run(); expect(contacts[0].title).toBeNull();
});
it('dedupes existing dismissal keys while appending Undo suppression', async () => {
  lead.website = null; lead.dismissed_suggestions = ['person:other', 'person:other'];
  const out = await run();
  await undoDeepFindChange(service, 'user', 'lead', out.domains.auto_applied.find(c => c.field === 'website'));
  expect(lead.dismissed_suggestions).toEqual(['person:other', 'website:acme.com']);
});

it('Low keeps free Companies House with a key and does not claim Gemini is missing', async () => {
  resolveOrgApiKey.mockResolvedValue('fake');
  const out = await run('low');
  expect(searchCompaniesByName).toHaveBeenCalled();
  expect(out.domains.steps.join(' ')).not.toContain('LinkedIn search skipped');
});
it('accepts a saved registered name when the site only carries that legal name', async () => {
  lead.company_number = '13550006'; lead.business_name = 'Trading Brand';
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  fetchCompanyProfile.mockResolvedValue({ name: 'OTHER LEGAL ENTITY LIMITED', address: null, locality: null });
  readCompanyPages.mockResolvedValue(['<title>OTHER LEGAL ENTITY LIMITED</title><footer>OTHER LEGAL ENTITY LIMITED</footer>']);
  const out = await run('low');
  expect(out.domains.steps.join(' ')).not.toContain('may belong to a different company');
  expect(fetchCompanyProfile).toHaveBeenCalledTimes(1);
});
it.each(['medium', 'high'])('%s runs guesses on a domain first confirmed by deep web search', async effort => {
  contacts[0].email = null;
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  discoverLeadDomains.mockResolvedValueOnce({ domains: [], people: [], notes: [], problems: [], sitePages: [] })
    .mockResolvedValueOnce({ domains: [{ domain: 'newco.com', sources: ['web'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  await run(effort);
  expect(worker.verifyEmail.mock.calls.some(([email]) => email.endsWith('@newco.com'))).toBe(true);
});
it('valid suggestion-only guesses do not stop Medium deepening', async () => {
  contacts = []; lead.owner_name = 'Jane Smith';
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  const out = await run('medium');
  expect(out.domains.steps.join(' ')).toContain('deeper steps ran');
});
it.each([null, 'Account Manager', 'Product Owner'])('contact title %s is not a decision maker', async title => {
  contacts[0].title = title;
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  const out = await run('medium');
  expect(out.domains.steps.join(' ')).toContain('a named decision maker, so deeper steps ran');
});

it.each(['hunter', 'apollo', 'web'])('Medium counts a titled person from %s', async source => {
  contacts[0].title = 'Sales Manager'; contacts[0].source = source;
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain('deeper steps were skipped');
});
it.each([null, 'Director'])('web person with role %s controls depth', async role => {
  contacts[0].title = null;
  discoverLeadDomains.mockResolvedValue({ domains: [], people: [{ name: 'Alex Brown', role }], notes: [], problems: [], sitePages: [] });
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain(role ? 'deeper steps were skipped' : 'a named decision maker, so deeper steps ran');
});
it('site text containing only a name does not satisfy the decision maker gate', async () => {
  contacts[0].title = null;
  readCompanyPages.mockResolvedValue(['<title>Acme</title><p>Alex Brown</p>']);
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain('a named decision maker, so deeper steps ran');
});
it('Medium counts an active individual registry officer even without an owner title', async () => {
  lead.company_number = '13550006'; contacts[0].title = null;
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'companies_house' ? 'fake' : null);
  fetchActiveOfficers.mockResolvedValue([{ first_name: 'Alex', last_name: 'Brown', title: 'Secretary' }]);
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain('deeper steps were skipped');
});
it('Medium counts a checker-valid lead email', async () => {
  contacts[0].email = null; lead.email = 'office@acme.com';
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain('deeper steps were skipped');
});
it('uses the raw lead legal name before website suspicion', async () => {
  lead.raw_lead_id = 'raw'; lead.business_name = 'Trading Brand';
  const original = service.from;
  service.from = table => table === 'raw_leads' ? { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { source: 'companies_house', source_id: '13550006', raw_data: { company: { title: 'OTHER LEGAL ENTITY LIMITED' } } } }) } : original(table);
  readCompanyPages.mockResolvedValue(['<title>OTHER LEGAL ENTITY LIMITED</title><footer>OTHER LEGAL ENTITY LIMITED</footer>']);
  expect((await run('low')).domains.steps.join(' ')).not.toContain('may belong to a different company');
});
it.each(['low', 'medium', 'high', 'extra_high'])('%s allows OpenCorporates only for Extra high', async effort => {
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => p === 'opencorporates' ? 'fake' : null);
  await run(effort);
  expect(lookupOpenCorporatesOfficer).toHaveBeenCalledTimes(effort === 'extra_high' ? 1 : 0);
});
it.each([false, true])('late-domain inference stops Hunter after any unverifiable checker result, configured: %s', async hunter => {
  contacts[0].email = null; lead.owner_name = 'Alex Brown';
  resolveOrgApiKey.mockImplementation(async (_s,_o,p) => hunter && p === 'hunter' ? 'fake' : null);
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'unverifiable', reason: 'test' } });
  hunterVerifyEmail.mockResolvedValue({ ok: true, verdict: 'unverifiable' });
  discoverLeadDomains.mockResolvedValueOnce({ domains: [], people: [], notes: [], problems: [], sitePages: [] })
    .mockResolvedValueOnce({ domains: [{ domain: 'newco.com', sources: ['web'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] });
  readCompanyPages.mockImplementation(async url => url.includes('newco.com') ? ['<title>Acme</title><p>alex.brown@newco.com</p>'] : []);
  await run('medium');
  expect(worker.verifyEmail).toHaveBeenCalledWith('jane.smith@newco.com', { timeoutMs: expect.any(Number) });
  expect(worker.verifyEmail.mock.calls[0][1].timeoutMs).toBeLessThanOrEqual(12_000);
  expect(hunterVerifyEmail).not.toHaveBeenCalled();
});

it('historical registry source alone does not prove an active decision maker', async () => {
  contacts[0].source = 'companies_house'; contacts[0].title = 'Secretary';
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  expect((await run('medium')).domains.steps.join(' ')).toContain('a named decision maker, so deeper steps ran');
});

it('keeps supported LinkedIn profiles as suggestions when live full names are ambiguous', async () => {
  contacts.push({ ...contacts[0], id: 'other', first_name: 'Jane Alice' });
  const out = await run('high');
  expect(webSearchForPerson).toHaveBeenCalled();
  expect(writes.some(w => w.patch.linkedin_url)).toBe(false);
  expect(out.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'linkedin_url', value: profile }));
});
it('does not let a dismissed alias hide a unique live LinkedIn match', async () => {
  contacts.unshift({ ...contacts[0], id: 'dismissed', dismissed_at: '2026-10-20' });
  await run('high');
  expect(contacts.find(c => c.id === 'c').linkedin_url).toBe(profile);
  expect(contacts.find(c => c.id === 'dismissed').linkedin_url).toBeNull();
});
it('can check and fill a unique contact just created by the wide lookup', async () => {
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  lookUpPeople.mockImplementationOnce(async ctx => {
    const added = { id: 'new-person', lead_id: 'lead', first_name: 'Alex', last_name: 'Brown', email: null, dismissed_at: null };
    contacts.push(added);
    await ctx.saveContact(added, { email: 'alex@acme.com' });
    return { created: [added], touched: [], emailsFound: 1, suggestions: [], problems: [], results: [] };
  });
  await run('high');
  expect(contacts.find(c => c.id === 'new-person').email).toBe('alex@acme.com');
});

it('late own-site reads preserve the downstream people and checker reserve', async () => {
  contacts[0].email = null;
  resolveOrgWorkerConfig.mockResolvedValue({});
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'test' } });
  let elapsed = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => elapsed);
  discoverLeadDomains.mockImplementation(async (_s,_l,options) => {
    if (!options.allow.web) return { domains: [], people: [], notes: [], problems: [], sitePages: [] };
    elapsed = 20_000;
    return { domains: [{ domain: 'newco.com', sources: ['web'], needs_check: false }], people: [], notes: [], problems: [], sitePages: [] };
  });
  await run('medium');
  expect(readCompanyPages.mock.calls.some(([url]) => url.includes('newco.com'))).toBe(false);
  expect(worker.verifyEmail.mock.calls.some(([email]) => email.endsWith('@newco.com'))).toBe(true);
});

it.each(['manual', 'dream_agent', 'companies_house', 'cro', 'hunter', 'apollo'])('gives dismissal recovery advice for %s contacts', async source => {
  contacts[0].dismissed_at = 'yesterday'; contacts[0].source = source;
  const out = await run('low');
  const lines = out.domains.steps.join(' ');
  expect(lines).toContain('Restore them from the lead page.');
  expect(lines.includes('Use Start fresh')).toBe(['companies_house', 'cro', 'hunter', 'apollo'].includes(source));
});
it('mentions Start fresh when an automatic dismissed contact is beyond the three named steps', async () => {
  contacts = ['Jane', 'Alex', 'Alice', 'Ravi'].map((first_name, i) => ({ id: 'c' + i, lead_id: 'lead', first_name,
    last_name: 'Smith', dismissed_at: 'yesterday', source: i === 3 ? 'hunter' : 'manual' }));
  const out = await run('low');
  expect(out.domains.steps.filter(s => s.includes('was dismissed earlier'))).toHaveLength(3);
  expect(out.domains.steps.join(' ')).toContain('and 1 more people were dismissed earlier.');
  expect(out.domains.steps.join(' ')).toContain('Use Start fresh');
});
