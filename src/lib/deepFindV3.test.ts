import { describe, expect, it, vi } from 'vitest';
import {
  apolloOrgDomains, runDomainDiscovery, safeFailure, type DiscoveryDeps, type DiscoveryInput,
} from '../../supabase/functions/_shared/domainDiscovery';
import { DOMAIN_CHECKS } from '../../supabase/functions/_shared/domainChecks';
import { creditLine, problemLines, MAX_PROBLEM_LINES } from '../../supabase/functions/_shared/deepFindProblems';
import { companyNameVariants } from '../../supabase/functions/_shared/nameVariants';

const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  names: ['Love Living'], variants: companyNameVariants(['Love Living']).map((v) => v.text), registeredName: null,
  people: [{ first: 'Max', last: 'Whatley' }], website: null, websiteDomain: null, known: [],
  allow: { hunter: true, site: false, web: false, apollo: false }, budgetMs: 60_000, ...over,
});
const deps = (over: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
  now: () => 0,
  hunterByName: vi.fn(async () => ({ ok: false as const, failure: 400 })),
  readSite: vi.fn(async () => []),
  webSearch: vi.fn(async () => ({ ok: false as const, failure: 'timeout' })),
  mx: vi.fn(async () => 'none' as const),
  hunterList: vi.fn(async () => ({ ok: true as const, organization: null, emails: [] })),
  hunterFindByCompany: vi.fn(async () => ({ ok: false as const, failure: 404 })),
  ...over,
});

describe('discovery with name variants', () => {
  it('searches Hunter with every variant, treats 400/404 as no match, and stops at the cap', async () => {
    const d = deps();
    const r = await runDomainDiscovery(input({ hunterCap: 5 }), d, DOMAIN_CHECKS);
    expect(d.hunterByName).toHaveBeenCalledWith('loveliving', expect.any(Number));
    expect(r.hunterCalls).toBe(5);
    expect(r.problems.filter((p) => p.step.startsWith('hunter'))).toEqual([]);
  });

  it('stops Hunter company searches once a domain is corroborated', async () => {
    const d = deps({
      hunterByName: vi.fn(async (n: string) => (n === 'loveliving'
        ? { ok: true as const, domain: 'loveliving.uk', organization: 'Love Living' } : { ok: false as const, failure: 404 })),
      hunterFindByCompany: vi.fn(async () => ({ ok: true as const, email: 'max@loveliving.uk', score: 90 })),
    });
    const r = await runDomainDiscovery(input(), d, DOMAIN_CHECKS);
    expect(r.discovered.find((x) => x.domain === 'loveliving.uk')?.needs_check).toBe(false);
    // Finder confirmed it on the first try: no more finder calls for other names.
    expect(d.hunterFindByCompany).toHaveBeenCalledTimes(1);
  });

  it('probes name-built domains from the variants and explains the ones with no mail server', async () => {
    const d = deps({
      mx: vi.fn(async (x: string) => (x === 'lovelivinglondon.co.uk' ? 'mx' as const : 'none' as const)),
      hunterList: vi.fn(async () => ({ ok: true as const, organization: 'Love Living', emails: [{ first_name: 'Max', last_name: 'Whatley' }] })),
    });
    const r = await runDomainDiscovery(input({ allow: { hunter: true, site: false, web: false } }), d, DOMAIN_CHECKS);
    expect(r.discovered.find((x) => x.domain === 'lovelivinglondon.co.uk')).toMatchObject({ needs_check: false, sources: ['person_confirmed'] });
    expect(r.problems).toContainEqual({ step: 'domain_check', target: 'loveliving.uk', failure: 'no_mx' });
  });

  it('reports a real Hunter failure and a web search that had no time', async () => {
    const r = await runDomainDiscovery(input({ allow: { hunter: true, site: false, web: true }, budgetMs: 60_000 }), deps({
      hunterByName: vi.fn(async () => ({ ok: false as const, failure: 429 })),
    }), DOMAIN_CHECKS);
    expect(r.problems).toContainEqual({ step: 'hunter_company', target: 'Love Living', failure: '429' });
    expect(r.problems).toContainEqual({ step: 'web', target: 'company', failure: 'timeout' });
  });

  it('treats Apollo 401/402/403 as "not on your plan", never a failure, and stops Apollo', async () => {
    const apolloOrg = vi.fn(async () => ({ ok: false as const, failure: 403 }));
    const r = await runDomainDiscovery(input({ allow: { hunter: false, site: false, web: false, apollo: true } }), deps({ apolloOrg }), DOMAIN_CHECKS);
    expect(apolloOrg).toHaveBeenCalledTimes(1);
    expect(r.problems.filter((p) => p.step === 'apollo')).toEqual([]);
    expect(r.notes).toContain('Apollo company search is not available on your Apollo plan, so it was skipped.');
  });

  it('keeps an Apollo organisation domain as a weak signal only', async () => {
    const apolloOrg = vi.fn(async () => ({ ok: true as const, json: { organizations: [{ name: 'Love Living', primary_domain: 'loveliving.uk' }] } }));
    const r = await runDomainDiscovery(input({ allow: { hunter: false, site: false, web: false, apollo: true } }), deps({ apolloOrg }), DOMAIN_CHECKS);
    expect(r.discovered).toContainEqual({ domain: 'loveliving.uk', sources: ['apollo_org'], needs_check: true });
  });
});

describe('apolloOrgDomains', () => {
  it('reads organisations and accounts defensively and refuses other companies', () => {
    const json = {
      organizations: [
        { name: 'Love Living Ltd', website_url: 'https://www.loveliving.co.uk/about' },
        { name: 'Living Social', primary_domain: 'livingsocial.com' },
        'junk', null,
      ],
      accounts: [{ name: 'Love Living', primary_domain: 'gmail.com' }],
    };
    expect(apolloOrgDomains(json, ['Love Living'], DOMAIN_CHECKS)).toEqual(['loveliving.co.uk']);
    expect(apolloOrgDomains('nope', ['Love Living'], DOMAIN_CHECKS)).toEqual([]);
    expect(apolloOrgDomains({ organizations: 'x' }, ['Love Living'], DOMAIN_CHECKS)).toEqual([]);
  });
});

describe('problem lines', () => {
  it('writes one plain line per failed step, deduplicated and capped', () => {
    expect(problemLines([
      { step: 'hunter_company', target: 'loveliving', failure: '429' },
      { step: 'hunter_company', target: 'loveliving', failure: '429' },
      { step: 'domain_check', target: 'loveliving.uk', failure: 'no_mx' },
      { step: 'web', target: 'company', failure: 'timeout' },
      { step: 'person', target: 'Max Whatley, Hunter email finder (loveliving.uk)', failure: '401' },
      { step: 'nonsense', target: 'x', failure: '500' },
    ])).toEqual([
      'Hunter company search (loveliving): Hunter refused the request (error 429, too many requests, try again later).',
      'Domain check loveliving.uk: no email set up.',
      'Web search: ran out of time.',
      'Looking up Max Whatley, Hunter email finder (loveliving.uk): Hunter did not accept the saved API key (error 401).',
    ]);
    const many = Array.from({ length: 40 }, (_, i) => ({ step: 'domain_check', target: `x${i}.uk`, failure: 'no_mx' }));
    expect(problemLines(many)).toHaveLength(MAX_PROBLEM_LINES);
  });
  it('maps unknown failure values to safe codes', () => {
    expect(safeFailure(403)).toBe('403');
    expect(safeFailure('<script>')).toBe('network');
    expect(safeFailure('cap_reached')).toBe('cap_reached');
  });
  it('writes the credits per step', () => {
    expect(creditLine({ hunter: { 'company domains': 5, 'company lists': 4 }, ai: { 'web search': 1 } }))
      .toBe('Credits used: Hunter 9 (company domains 5, company lists 4), AI 1 (web search 1).');
    expect(creditLine({ hunter: {}, ai: {} })).toBe('Credits used: Hunter 0, AI 0.');
  });
});

describe('Hunter refusals stop the run', () => {
  it('asks Hunter only once after a 429', async () => {
    const d = deps({ hunterByName: vi.fn(async () => ({ ok: false as const, failure: 429 })) });
    const r = await runDomainDiscovery(input(), d, DOMAIN_CHECKS);
    expect(r.hunterCalls).toBe(1);
    expect(d.hunterFindByCompany).not.toHaveBeenCalled();
  });
});

describe('web search runs in parallel', () => {
  it('starts the web search before Hunter and gives it its own budget', async () => {
    const order: string[] = [];
    let clock = 0;
    const d = deps({
      now: () => clock,
      webSearch: vi.fn(async (t: number) => { order.push(`web:${t}`); return { ok: true as const, text: '{"websites":[],"email_domains":[],"people":[]}' }; }),
      hunterByName: vi.fn(async () => { order.push('hunter'); clock += 20_000; return { ok: false as const, failure: 404 }; }),
    });
    const r = await runDomainDiscovery(input({ allow: { hunter: true, site: false, web: true }, budgetMs: 30_000 }), d, DOMAIN_CHECKS);
    expect(order[0]).toBe('web:25000');
    expect(r.problems.filter((p) => p.step === 'web')).toEqual([]);
    expect(r.aiCalls).toBe(1);
  });
});
