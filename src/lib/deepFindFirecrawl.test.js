// Actual engine with bounded fake provider/database dependencies. No network or credentials.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindRegistry', () => ({ resolveRegistry: vi.fn(), registryStep: () => 'Registry checked.' }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ readCompanyPages: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ fetchActiveOfficers: vi.fn() }));
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';
import { resolveRegistry } from '../../supabase/functions/_shared/deepFindRegistry';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { readCompanyPages, hunterAccount, hunterDomainList, hunterVerifyEmail } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { makeWorkerClient } from '../../supabase/functions/_shared/workerClient';
import { fetchActiveOfficers } from '../../supabase/functions/_shared/companiesHouse';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';
let request, service, write, contacts, checkpointError, checkpointReads, accessLostAt, cancelledAt, worker;
beforeEach(() => {
  vi.clearAllMocks(); contacts = []; checkpointError = false; checkpointReads = 0;
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
    const data = table === 'leads' ? { id: 'lead', org_id: 'org', website: 'https://example.com', business_name: 'Example', owner_name: null }
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
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = await process();
  expect(result.status).toBe('done');
  expect(hunterDomainList).toHaveBeenCalledOnce();
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
  pendingPaidAndContactWork(); contacts = []; accessLostAt = 1;
  vi.mocked(resolveOrgApiKey).mockResolvedValue('fake-key');
  vi.mocked(resolveRegistry).mockResolvedValue({ number: '12345678', name: 'Example', address: null, candidates: [] });
  vi.mocked(fetchActiveOfficers).mockResolvedValue([{ first_name: 'Jane', last_name: 'Smith', title: null }]);
  const result = await process();
  expect(result).toMatchObject({ status: 'skipped', people_found: 1 });
  expect(contacts).toEqual([expect.objectContaining({ first_name: 'Jane', last_name: 'Smith', source: 'companies_house' })]);
  expect(write).toHaveBeenCalledExactlyOnceWith('insert', expect.any(Array));
  expect(hunterDomainList).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
