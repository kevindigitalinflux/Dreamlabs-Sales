// Actual engine with bounded fake provider/database dependencies. No network or credentials.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/orgApiKeys', () => ({ resolveOrgApiKey: vi.fn(), resolveOrgWorkerConfig: vi.fn() }));
vi.mock('../../supabase/functions/_shared/rateLimit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindRegistry', () => ({ resolveRegistry: vi.fn(), registryStep: () => 'Registry checked.' }));
vi.mock('../../supabase/functions/_shared/domainDiscoveryLookup', () => ({ discoverLeadDomains: vi.fn() }));
vi.mock('../../supabase/functions/_shared/knownPersonLookup', () => ({ readCompanyPages: vi.fn(), hunterAccount: vi.fn(), hunterDomainList: vi.fn(), hunterVerifyEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/deepFindPeople', () => ({ lookUpPeople: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workerClient', () => ({ makeWorkerClient: () => ({
  scrapeSite: async () => ({ ok: false, failure: 'not_configured' }), lines: () => [],
}) }));
import { resolveOrgApiKey, resolveOrgWorkerConfig } from '../../supabase/functions/_shared/orgApiKeys';
import { checkRateLimit } from '../../supabase/functions/_shared/rateLimit';
import { resolveRegistry } from '../../supabase/functions/_shared/deepFindRegistry';
import { discoverLeadDomains } from '../../supabase/functions/_shared/domainDiscoveryLookup';
import { readCompanyPages } from '../../supabase/functions/_shared/knownPersonLookup';
import { lookUpPeople } from '../../supabase/functions/_shared/deepFindPeople';
import { processDeepFindLead } from '../../supabase/functions/_shared/deepFind';
let request, service, write, contacts, checkpointError, checkpointReads;
beforeEach(() => {
  vi.clearAllMocks(); contacts = []; checkpointError = false; checkpointReads = 0;
  vi.stubGlobal('Deno', { env: { get: () => undefined } }); write = vi.fn();
  vi.mocked(resolveOrgApiKey).mockImplementation(async (_s, _o, provider) => provider === 'firecrawl' ? 'fake-key' : null);
  vi.mocked(resolveOrgWorkerConfig).mockResolvedValue(null);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(resolveRegistry).mockResolvedValue({ number: null, name: null, address: null, candidates: [] });
  vi.mocked(discoverLeadDomains).mockResolvedValue({ domains: [{ domain: 'example.com', needs_check: false, sources: ['website'] }], people: [], notes: [], problems: [], sitePages: [] });
  vi.mocked(readCompanyPages).mockResolvedValue([]);
  vi.mocked(lookUpPeople).mockResolvedValue({ created: [], touched: [], emailsFound: 0, suggestions: [], problems: [] });
  request = vi.fn(async () => Response.json({ success: true, data: { rawHtml: '<p>Jane Smith, Director</p>', metadata: { url: 'https://example.com/team' } } }));
  vi.stubGlobal('fetch', request);
  service = { rpc: vi.fn(async () => ({ data: true, error: null })), from(table) {
    const data = table === 'leads' ? { id: 'lead', org_id: 'org', website: 'https://example.com', business_name: 'Example', owner_name: null }
      : table === 'deep_find_runs' ? { status: 'active' } : contacts;
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: table === 'deep_find_runs' && ++checkpointReads === checkpointError ? { message: 'private-checkpoint' } : null }),
      insert: write, upsert: write, update: write, then: (resolve) => resolve({ data, error: null }) };
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
