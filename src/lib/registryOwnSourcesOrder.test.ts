import { expect, it } from 'vitest';
import { runDomainDiscovery } from '../../supabase/functions/_shared/domainDiscovery';
import { DOMAIN_CHECKS } from '../../supabase/functions/_shared/domainChecks';

it('finishes own DNS, site and web callbacks before the first Hunter request', async () => {
  const calls: string[] = [];
  await runDomainDiscovery({
    names: ['Bright Fox'], website: 'https://brightfox.com', websiteDomain: 'brightfox.com', known: [],
    allow: { hunter: true, site: true, web: true }, budgetMs: 30_000,
  }, {
    now: () => 0,
    hunterByName: async () => { calls.push('hunter'); return { ok: false, failure: 'cap_reached' }; },
    readSite: async () => { calls.push('site'); return []; },
    mx: async () => { calls.push('dns'); return 'none'; },
    webSearch: async () => { await Promise.resolve(); calls.push('web'); return { ok: true, text: '{}' }; },
  }, DOMAIN_CHECKS);
  expect(calls).toContain('hunter');
  for (const own of ['dns', 'site', 'web']) {
    expect(calls.indexOf(own), `${own}: ${calls.join(', ')}`).toBeLessThan(calls.indexOf('hunter'));
  }
});

import { vi } from 'vitest';
import type { DiscoveryDeps, DiscoveryInput } from '../../supabase/functions/_shared/domainDiscovery';

const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  names: ['Bright Fox'], website: 'https://brightfox.com', websiteDomain: 'brightfox.com', known: [],
  allow: { hunter: true, site: true, web: true, apollo: true }, budgetMs: 30_000, ...over,
});
const deps = (over: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
  now: () => 0,
  hunterByName: vi.fn(async () => ({ ok: false as const, failure: 404 })),
  hunterFindByCompany: vi.fn(async () => ({ ok: false as const, failure: 404 })),
  hunterList: vi.fn(async () => ({ ok: true as const, organization: null, emails: [] })),
  readSite: vi.fn(async () => []),
  readDomainSite: vi.fn(async () => []),
  mx: vi.fn(async () => 'mx' as const),
  webSearch: vi.fn(async () => ({ ok: true as const, text: '{}' })),
  ...over,
});

it.each(['supplied site', 'domain site'])('skips every Hunter callback after %s corroborates a domain', async source => {
  const html = '<title>Bright Fox</title><a href="mailto:jane@brightfox.co.uk">Contact</a><a href="https://brightfox.co.uk">Team</a>';
  const d = deps(source === 'supplied site' ? { readSite: vi.fn(async () => [html]) }
    : { readDomainSite: vi.fn(async () => [html]) });
  const out = await runDomainDiscovery(input(), d, DOMAIN_CHECKS);
  expect(out.domains.some(d => !d.needs_check)).toBe(true);
  expect(d.hunterByName).not.toHaveBeenCalled();
  expect(d.hunterFindByCompany).not.toHaveBeenCalled();
  expect(d.hunterList).not.toHaveBeenCalled();
  expect(out.hunterCalls).toBe(0);
});

it('uses Hunter for weak own signals and keeps the total cap', async () => {
  const d = deps({ webSearch: async () => ({ ok: true, text: '{"email_domains":["brightfox.com"]}' }) });
  const out = await runDomainDiscovery(input({ hunterCap: 2, people: [{ first: 'Jane', last: 'Smith' }] }), d, DOMAIN_CHECKS);
  expect(d.hunterByName).toHaveBeenCalled();
  expect(out.hunterCalls).toBe(2);
  expect(d.hunterList).not.toHaveBeenCalled();
});

it.each(['cap_reached', 429] as const)('retains own hints when Hunter refuses with %s', async failure => {
  const d = deps({ hunterByName: vi.fn(async () => ({ ok: false as const, failure })) });
  const out = await runDomainDiscovery(input({ known: [{ domain: 'brightfox.com', source: 'web' }] }), d, DOMAIN_CHECKS);
  expect(out.domains.some(d => d.domain === 'brightfox.com')).toBe(true);
  expect(d.hunterByName).toHaveBeenCalledTimes(1);
  expect(d.hunterFindByCompany).not.toHaveBeenCalled();
  expect(d.hunterList).not.toHaveBeenCalled();
  expect(out.problems.filter(p => p.step.startsWith('hunter'))).toHaveLength(failure === 429 ? 1 : 0);
});

it('continues Hunter after web failure when time remains', async () => {
  const d = deps({ webSearch: async () => ({ ok: false, failure: 'network' }) });
  const out = await runDomainDiscovery(input({ hunterCap: 1 }), d, DOMAIN_CHECKS);
  expect(d.hunterByName).toHaveBeenCalledTimes(1);
  expect(out.problems.some(p => p.step === 'web')).toBe(true);
});

it('quietly skips Hunter when the web wait consumes its minimum time', async () => {
  let now = 0;
  const d = deps({ now: () => now, webSearch: async () => { now = 29_000; return { ok: true, text: '{}' }; } });
  const out = await runDomainDiscovery(input(), d, DOMAIN_CHECKS);
  expect(out.hunterCalls).toBe(0);
  expect(d.hunterByName).not.toHaveBeenCalled();
  expect(out.problems.filter(p => p.step.startsWith('hunter'))).toEqual([]);
});
