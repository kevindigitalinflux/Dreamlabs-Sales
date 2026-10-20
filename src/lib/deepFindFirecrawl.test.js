// Actual engine with bounded fake provider/database dependencies. No network or credentials.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindRegistry', () => ({ resolveRegistry: vi.fn(), registryStep: () => 'Registry checked.' }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ webSearchDomainFormat: vi.fn(async () => []), readCompanyPages: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn(), fetchCompanyProfile: vi.fn(), fetchOfficerAppointments: vi.fn(), searchCompaniesByName: vi.fn(), searchOfficers: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: (...args) => service.from(...args) } }));
import { applyLeadUpdate } from './leadUpdates';
import { rejectDeepFindCompanies } from './deepFindReview';
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';
import { resolveRegistry } from '../../supabase/functions/_shared/deepFindRegistry';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { readCompanyPages, hunterAccount, hunterDomainList, hunterVerifyEmail } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient';
import { fetchActiveOfficers } from '../../supabase/functions/_shared/companiesHouse';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';
let request, service, write, contacts, checkpointError, checkpointReads, accessLostAt, cancelledAt, worker, leadOverrides;
beforeEach(() => {
  vi.clearAllMocks(); contacts = []; leadOverrides = {}; checkpointError = false; checkpointReads = 0;
  accessLostAt = 0; cancelledAt = 0;
  worker = { scrapeSite: vi.fn(async () => ({ ok: false, failure: 'not_configured' })),
    verifyEmail: vi.fn(async () => ({ ok: false, failure: 'not_configured' })), lines: () => [] };
  vi.mocked(makeWorkerClient).mockReturnValue(worker);
  vi.stubGlobal('Deno', { env: { get: () => undefined } }); write = vi.fn();
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'firecrawl' ? 'fake-key' : null);
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue(null);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(resolveRegistry).mockResolvedValue({ number: null, name: null, address: null, candidates: [] });
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: false, sources: ['website'] }], people: [], notes: [], problems: [], sitePages: [] });
  vi.mocked(readCompanyPages).mockResolvedValue([]);
  vi.mocked(hunterAccount).mockResolvedValue({ ok: false, failure: 'network' });
  vi.mocked(hunterDomainList).mockResolvedValue({ ok: true, emails: [], pattern: null });
  vi.mocked(hunterVerifyEmail).mockResolvedValue({ ok: true, verdict: 'verified' });
  vi.mocked(fetchActiveOfficers).mockResolvedValue([]);
  vi.mocked(lookUpPeople).mockResolvedValue({ created: [], touched: [], emailsFound: 0, suggestions: [], problems: [] });
  request = vi.fn(async () => Response.json({ success: true, data: { rawHtml: '<p>Jane Smith, Director</p>', metadata: { url: 'https://example.com/team' } } }));
  vi.stubGlobal('fetch', request);
  service = { rpc: vi.fn(async (name) => ({ data: !(name === 'deep_find_creator_can_edit' && checkpointReads > 0 && checkpointReads === accessLostAt), error: null })), from(table) {
    const data = table === 'leads' ? { id: 'lead', org_id: 'org', website: 'https://example.com', business_name: 'Example', owner_name: null, ...leadOverrides }
      : table === 'deep_find_runs' ? { status: 'active' } : contacts;
    const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: async () => {
      if (table === 'deep_find_runs') {
        checkpointReads++;
        return { data: { status: checkpointReads === cancelledAt ? 'cancelled' : 'active' },
          error: checkpointReads === checkpointError ? { message: 'private-checkpoint' } : null };
      }
      return { data, error: null };
    }, insert: (rows) => { write('insert', rows); contacts.push(...rows); return query; },
      upsert: (rows) => { write('upsert', rows); return query; }, update: (patch) => { write('update', patch); return query; },
      then: (resolve) => resolve({ data, error: null }) };
    return query;
  } };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const process = () => processDeepFindLead(service, { id: 'run', org_id: 'org', created_by: 'user', status: 'active' }, { id: 'row', lead_id: 'lead', org_id: 'org' });
it('tries common formats without an inferred pattern and fills only the existing blank contact', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'contact', first_name: 'Valentina', last_name: 'Antunovic', title: 'Founder', email: null, include_in_sequences: true }];
  worker.verifyEmail.mockResolvedValueOnce({ ok: true, value: { status: 'invalid', reason: 'mailbox_missing' } })
    .mockResolvedValueOnce({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  const result = await process();
  expect(worker.verifyEmail.mock.calls.map(([e]) => e)).toEqual(['valentina.antunovic@example.com', 'valentina@example.com', 'vantunovic@example.com']);
  expect(write).toHaveBeenCalledWith('update', expect.objectContaining({ email: 'valentina@example.com', include_in_sequences: false }));
  expect(result.domains.steps.join(' ')).toContain('Guessed from common formats and confirmed by our email checker, check it');
});
it('stops catch-all checks and offers one ranked guess with collapsed alternatives per person', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null },
    { id: 'two', first_name: 'John', last_name: 'Jones', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'risky', reason: 'catch_all' } });
  const result = await process();
  expect(worker.verifyEmail).toHaveBeenCalledTimes(3);
  expect(write).not.toHaveBeenCalled();
  expect(result.domains.suggestions.filter(s => s.guess_rank === 'most_likely').map(s => s.value)).toEqual(['jane.smith@example.com', 'john.jones@example.com']);
  expect(result.domains.suggestions.filter(s => s.guess_rank === 'other')).toHaveLength(8);
  expect(result.domains.suggestions.every(s => s.label.includes('unverified'))).toBe(true);
});
it('retains a literal website find when the domain is catch-all, without repeating that address', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  leadOverrides = { owner_name: 'Jane Smith' };
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: false, sources: ['website'] }],
    people: [], notes: [], problems: [], sitePages: [{ domain: 'example.com', pages: ['<a href="mailto:jane.smith@example.com">Jane Smith</a>'] }] });
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'risky', reason: 'catch_all' } });
  const result = await process();
  expect(result.domains.suggestions.filter((s) => s.value === 'jane.smith@example.com')).toEqual([
    expect.objectContaining({ label: 'Found on example.com, check it' }),
  ]);
  expect(worker.verifyEmail).toHaveBeenCalledTimes(3);
});
it('does not repeat an inferred-format address among common guesses and never exceeds five per domain', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'sample', first_name: 'Max', last_name: 'Jones', email: 'max.jones@example.com' },
    { id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'invalid', reason: 'mailbox_missing' } });
  await process();
  const addresses = worker.verifyEmail.mock.calls.map(([e]) => e);
  expect(addresses).toHaveLength(5);
  expect(new Set(addresses).size).toBe(5);
  expect(addresses[0]).toBe('jane.smith@example.com');
});
it('stops at an existing inferred format when the checker confirms it', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'sample', first_name: 'Max', last_name: 'Jones', email: 'max.jones@example.com' },
    { id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  await process();
  expect(worker.verifyEmail).toHaveBeenCalledTimes(3);
  expect(worker.verifyEmail).toHaveBeenCalledWith('jane.smith@example.com', { timeoutMs: expect.any(Number) });
  expect(write).toHaveBeenCalledWith('update', expect.objectContaining({ email: 'jane.smith@example.com' }));
});
it('does not attempt common guesses on an unconfirmed domain', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: true, sources: ['web'] }], people: [], notes: [], problems: [], sitePages: [] });
  const result = await process();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(result.domains.steps.join(' ')).toContain('No company domain is confirmed.');
});
it('worker off stops common guesses immediately and gives one plain worker line', async () => {
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  const result = await process();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(result.domains.suggestions.filter(s => s.guess_rank === 'most_likely')).toHaveLength(1);
  expect(result.domains.steps.filter((s) => s.includes('Jane Smith: no email found.'))).toEqual([
    expect.stringContaining('Jane Smith: no email found.')
  ]);
});
it('reserves people time before admitting the browser scrape', async () => {
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  const start = Date.now();
  vi.spyOn(Date, 'now').mockReturnValueOnce(start).mockReturnValue(start + 20_000);
  await process();
  expect(worker.scrapeSite).not.toHaveBeenCalled();
});
it('also preserves the people floor when Firecrawl would otherwise read a team page', async () => {
  leadOverrides = { owner_name: 'Jane Smith' };
  const start = Date.now();
  vi.spyOn(Date, 'now').mockReturnValueOnce(start).mockReturnValue(start + 20_000);
  const result = await process();
  expect(request).not.toHaveBeenCalled();
  expect(lookUpPeople.mock.calls[0][0].people).toEqual([expect.objectContaining({ first: 'Jane', last: 'Smith' })]);
  expect(result.domains.steps).toContain('Firecrawl was skipped to leave time for the remaining checks.');
});
it.each(['risky', 'unverifiable', 'invalid'])('never fills a common guess with verdict %s', async (status) => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status, reason: 'unknown' } });
  const result = await process();
  expect(write).not.toHaveBeenCalled();
  expect(worker.verifyEmail).toHaveBeenCalledTimes(status === 'unverifiable' ? 3 : 5);
  expect(result.domains.steps.join(' ')).toContain(`Tried ${status === 'unverifiable' ? 3 : 5} common formats on example.com (none confirmed).`);
});
it.each(['busy', 'limit_reached', 'unreachable', 'bad_response'])('stops common guesses for the lead on %s', async (failure) => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null },
    { id: 'two', first_name: 'John', last_name: 'Jones', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: false, failure });
  await process();
  expect(worker.verifyEmail).toHaveBeenCalledTimes(3);
  expect(write).not.toHaveBeenCalled();
});
it('offers a valid guess for a site person for review without inserting a contact', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  const result = await process();
  expect(result.domains.suggestions).toEqual([expect.objectContaining({ name: 'Jane Smith', value: 'jane.smith@example.com', label: 'Guessed from common formats and confirmed by our email checker, check it' })]);
  expect(write).not.toHaveBeenCalled();
});
it('fetches officers after an accidental Ireland choice is corrected to UK', async () => {
  const actual = await vi.importActual('../../supabase/functions/_shared/deepFindRegistry');
  vi.mocked(resolveRegistry).mockImplementation(actual.resolveRegistry);
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'companies_house' ? 'fake-key' : null);
  leadOverrides = { country: 'GB', company_number: '12345678', registry_candidates_rejected: true };
  const originalFrom = service.from;
  service.from = (table) => {
    const q = originalFrom(table);
    if (table === 'leads') {
      const update = q.update;
      q.update = (patch) => { Object.assign(leadOverrides, patch); return update(patch); };
      q.single = async () => ({ data: leadOverrides, error: null });
    }
    return q;
  };
  await rejectDeepFindCompanies(service, 'lead', 'IE');
  expect(leadOverrides).toMatchObject({ country: 'IE', registry_candidates_rejected: false });
  // Simulate a stale rejection too: changing country must clear it.
  leadOverrides.registry_candidates_rejected = true;
  expect(await applyLeadUpdate('lead', { country: 'GB' }, { ...leadOverrides })).toBeNull();
  expect(leadOverrides.registry_candidates_rejected).toBe(false);
  await process();
  expect(fetchActiveOfficers).toHaveBeenCalledWith('12345678', 'fake-key');
});
it('filters remembered person dismissals from rerun results', async () => {
  leadOverrides = { dismissed_suggestions: ['person:jane smith'] };
  expect((await process()).domains.named_on_site).toEqual([]);
});
it.each([{ dismissed_suggestions: ['email:hello@example.com'] }, { email: 'HELLO@example.com' }, { additional_emails: ['HELLO@example.com'] }])('filters dismissed and already-saved addresses from rerun results: %j', async (saved) => {
  leadOverrides = saved;
  worker.scrapeSite.mockResolvedValue({ ok: true, value: { emails: [{ value: 'hello@example.com', source: null }], phones: [] } });
  expect((await process()).domains.suggestions.some(s => s.value === 'hello@example.com')).toBe(false);
});
it('uses the Irish website as a confirmed domain without the unusable-website summary', async () => {
  leadOverrides = { country: 'IE' };
  vi.mocked(readCompanyPages).mockResolvedValue(['<title>Example</title><p>+353 (0)1 234 5678</p>']);
  const result = await process();
  expect(result.domains.website_suspect).toBe(false);
  expect(discoverLeadDomains.mock.calls[0][2].websiteSuspect).toBe(false);
  expect(result.reason).not.toContain('no usable website');
});
it('keeps Firecrawl names under named_on_site, records one page, and never writes contacts', async () => {
  const result = await process();
  expect(result.domains.named_on_site).toEqual([{ name: 'Jane Smith', role: 'Director' }]);
  expect(JSON.stringify(result.domains)).toContain('Firecrawl 1 page');
  expect(checkRateLimit).toHaveBeenCalledWith(service, 'firecrawl-pages:org', 100, 1440, true);
  expect(request).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
});
it('does not scrape if a named person already has a role, or the domain is unconfirmed', async () => {
  contacts = [{ first_name: 'Jane', last_name: 'Smith', title: 'Director', email: 'jane@example.com' }];
  await process(); expect(request).not.toHaveBeenCalled();
  contacts = [];
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: true, sources: ['web'] }], people: [], notes: [], problems: [], sitePages: [] });
  await process(); expect(request).not.toHaveBeenCalled();
});

it('mentions a missing Firecrawl key only for eligible leads and never shows a zero counter', async () => {
  vi.mocked(resolveOrgApiKey).mockResolvedValue(null);
  contacts = [{ first_name: 'Jane', last_name: 'Smith', title: 'Director', email: 'jane@example.com' }];
  const ineligible = await process();
  expect(JSON.stringify(ineligible)).not.toContain('Firecrawl');
  contacts = [];
  const eligible = await process();
  expect(JSON.stringify(eligible)).toContain('Firecrawl is not set up for this organisation.');
  expect(JSON.stringify(eligible)).not.toContain('Firecrawl 0');
  expect(request).not.toHaveBeenCalled();
});
it.each([1, 2])('preserves the summary if Firecrawl access checkpoint %s fails mid-lead', async (at) => {
  checkpointError = at;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await process();
  expect(result.status).toBe('done');
  expect(result.domains).toBeDefined();
  expect(request).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith('deep find: Firecrawl checkpoint failed');
  expect(JSON.stringify(log.mock.calls)).not.toContain('private-checkpoint');
});

// These inputs leave real work pending AFTER Firecrawl: a site email can fill an existing
// contact, its format can invoke the worker/Hunter verifier, and Hunter can list the domain.
function pendingPaidAndContactWork() {
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) =>
    provider === 'firecrawl' || provider === 'hunter' ? 'fake-key' : null);
  contacts = [{ id: 'contact', first_name: 'Jane', last_name: 'Smith', title: null, email: null }];
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: false, sources: ['website'] }],
    people: [], notes: [], problems: [], sitePages: [{ domain: 'example.com', pages: ['<a href="mailto:jane.smith@example.com">Jane Smith</a>'] }] });
}

it.each([1, 2])('stops all downstream work when checkpoint %s confirms edit rights were lost', async (at) => {
  pendingPaidAndContactWork(); accessLostAt = at;
  const result = await process();
  expect(result).toMatchObject({ status: 'skipped', reason: 'Deep find is no longer authorised.' });
  expect(hunterAccount).toHaveBeenCalledOnce(); // Free check precedes the checkpoint.
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(hunterVerifyEmail).not.toHaveBeenCalled();
  expect(lookUpPeople).not.toHaveBeenCalled();
  expect(worker.scrapeSite).not.toHaveBeenCalled();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(contacts[0].email).toBeNull();
});

it.each([1, 2])('stops all downstream work when checkpoint %s confirms cancellation', async (at) => {
  pendingPaidAndContactWork(); cancelledAt = at;
  const result = await process();
  expect(result).toMatchObject({ status: 'skipped', reason: 'Deep find is no longer authorised.' });
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(hunterVerifyEmail).not.toHaveBeenCalled();
  expect(lookUpPeople).not.toHaveBeenCalled();
  expect(worker.scrapeSite).not.toHaveBeenCalled();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it.each([1, 2])('continues pending Hunter/worker/contact work after a transient checkpoint %s read failure', async (at) => {
  pendingPaidAndContactWork(); checkpointError = at;
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await process();
  expect(result.status).toBe('done');
  expect(hunterDomainList).not.toHaveBeenCalled(); // A free verified address suppresses paid company lists.
  expect(worker.verifyEmail).toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith('update', expect.objectContaining({ email: 'jane.smith@example.com' }));
  expect(request).not.toHaveBeenCalled();
  expect(log.mock.calls).toEqual([['deep find: Firecrawl checkpoint failed']]);
});

it('stops on confirmed cancellation even if a subsequent edit-rights read would throw', async () => {
  pendingPaidAndContactWork(); cancelledAt = 1;
  service.rpc.mockImplementation(async (name) => {
    if (name === 'deep_find_creator_can_edit' && checkpointReads > 0) throw new Error('private-checkpoint');
    return { data: true, error: null };
  });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await process();
  expect(result.status).toBe('skipped');
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});

it('retains contacts written before authorisation was lost', async () => {
  pendingPaidAndContactWork(); contacts = []; accessLostAt = 3; // Includes the new pre-insert dismissal checkpoint.
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => ['hunter', 'firecrawl', 'companies_house'].includes(provider) ? 'fake-key' : null);
  vi.mocked(resolveRegistry).mockResolvedValue({ number: '12345678', name: 'Example', address: null, candidates: [] });
  vi.mocked(fetchActiveOfficers).mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: null }]);
  const result = await process();
  expect(result).toMatchObject({ status: 'skipped', people_found: 1 });
  expect(contacts).toEqual([expect.objectContaining({ first_name: 'Jane', last_name: 'Smith', source: 'companies_house' })]);
  expect(write).toHaveBeenCalledExactlyOnceWith('insert', expect.any(Array));
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it('reports missing worker once for the lead with plain person lines', async () => {
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null },
    { id: 'two', first_name: 'John', last_name: 'Jones', title: 'Director', email: null }];
  const result = await process();
  expect(result.domains.steps.filter((s) => s.includes('not set up'))).toEqual([
    'The email checker is not set up, so email formats were not tried.'
  ]);
  expect(result.domains.steps.some(s => s.startsWith('Jane Smith: no email found.'))).toBe(true);
  expect(result.domains.steps.some(s => s.startsWith('John Jones: no email found.'))).toBe(true);
});
it.each([false, true])('retains legacy catch-all suggestions with Hunter available %s', async (hunter) => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => hunter && provider === 'hunter' ? 'fake-key' : null);
  contacts = [{ id: 'sample', first_name: 'Max', last_name: 'Jones', email: 'max.jones@example.com' },
    { id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null },
    { id: 'two', first_name: 'John', last_name: 'Brown', title: 'Director', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'risky', reason: 'catch_all' } });
  const result = await process();
  expect(worker.verifyEmail.mock.calls.map(([email]) => email)).toEqual(['jane.smith@example.com', 'john.brown@example.com', 'jane@example.com']);
  expect(hunterVerifyEmail).not.toHaveBeenCalled();
  for (const value of ['jane.smith@example.com', 'john.brown@example.com']) {
    expect(result.domains.suggestions).toContainEqual(expect.objectContaining({ value,
      label: expect.stringContaining('Most likely address') }));
  }
  expect(write).not.toHaveBeenCalled();
});
it('keeps Hunter verification evidence when the checker is absent', async () => {
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'hunter' ? 'fake-key' : null);
  contacts = [{ id: 'sample', first_name: 'Max', last_name: 'Jones', email: 'max.jones@example.com' },
    { id: 'one', first_name: 'Jane', last_name: 'Smith', email: null }];
  const result = await process();
  expect(hunterVerifyEmail).toHaveBeenCalled();
  expect(result.domains.suggestions).toContainEqual(expect.objectContaining({ value: 'jane.smith@example.com', label: expect.stringContaining('verified by Hunter') }));
  expect(write).not.toHaveBeenCalled();
});
it('keeps checker-valid guesses as suggestions when live full names are ambiguous', async () => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', email: null },
    { id: 'two', first_name: 'Jane Alice', last_name: 'Smith', email: null }];
  worker.verifyEmail.mockResolvedValue({ ok: true, value: { status: 'valid', reason: 'deliverable' } });
  const result = await process();
  expect(write).not.toHaveBeenCalled();
  expect(result.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'email', value: 'jane.smith@example.com' }));
});
it('offers Hunter data for ambiguous names without filling or adding a third contact', async () => {
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'hunter' ? 'fake-key' : null);
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', email: null },
    { id: 'two', first_name: 'Jane Alice', last_name: 'Smith', email: null }];
  vi.mocked(hunterDomainList).mockResolvedValue({ ok: true, pattern: null, emails: [{ first_name: 'Jane', last_name: 'Smith', position: 'Director', value: 'jane.smith@example.com', linkedin: 'https://www.linkedin.com/in/jane-smith' }] });
  const result = await process();
  expect(write).not.toHaveBeenCalled();
  expect(result.domains.suggestions).toContainEqual(expect.objectContaining({ field: 'email', value: 'jane.smith@example.com' }));
});
it('does not add an officer when existing live names are ambiguous', async () => {
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', email: null },
    { id: 'two', first_name: 'Jane Alice', last_name: 'Smith', email: null }];
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'companies_house' ? 'fake-key' : null);
  vi.mocked(resolveRegistry).mockResolvedValue({ number: '12345678', name: 'Example', candidates: [] });
  vi.mocked(fetchActiveOfficers).mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: null }]);
  await process();
  expect(write).not.toHaveBeenCalledWith('insert', expect.anything());
});
it('does not count a free-mail lead address as an own domain', async () => {
  leadOverrides = { website: null, email: 'example@gmail.com' };
  await processDeepFindLead(service, { id: 'run', org_id: 'org', created_by: 'user', status: 'active', credit_cap_hunter: 8, lead_count: 1 }, { id: 'row', lead_id: 'lead', org_id: 'org' });
  expect(discoverLeadDomains.mock.calls[0][2].hunterCap).toBe(8);
});
it.each([false, true])('preserves wide person lookup at 26 seconds with legacy pattern %s', async (legacy) => {
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue({ url: 'https://worker.example.com', secret: 'fake' });
  contacts = [{ id: 'one', first_name: 'Jane', last_name: 'Smith', title: 'Director', email: null }];
  if (legacy) contacts.push({ id: 'sample', first_name: 'Max', last_name: 'Jones', email: 'max.jones@example.com' });
  const start = Date.now();
  let elapsed = 44_000;
  vi.spyOn(Date, 'now').mockReturnValueOnce(start).mockImplementation(() => start + elapsed);
  worker.verifyEmail.mockImplementation(async () => { elapsed += 20_000; return { ok: true, value: { status: 'invalid', reason: 'mailbox_missing' } }; });
  await process();
  expect(worker.verifyEmail).not.toHaveBeenCalled();
  expect(lookUpPeople.mock.calls[0][0].people).toContainEqual(expect.objectContaining({ first: 'Jane', last: 'Smith' }));
});
