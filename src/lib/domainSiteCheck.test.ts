import { describe, expect, it, vi } from 'vitest';
import { domainEmailsOnPages, pageWords, siteConfirmLine, siteConfirmsCompany } from '../../supabase/functions/_shared/domainSiteCheck';
import { runDomainDiscovery, type DiscoveryDeps, type DiscoveryInput } from '../../supabase/functions/_shared/domainDiscovery';
import { DOMAIN_CHECKS } from '../../supabase/functions/_shared/domainChecks';

describe('siteConfirmsCompany', () => {
  it('never lets a domain confirm itself through its own address', () => {
    expect(pageWords('<p>Email hello@loveliving.uk or visit https://loveliving.uk and loveliving.uk</p>')).toEqual(['email', 'or', 'visit', 'and']);
    expect(siteConfirmsCompany(['<p>Contact hello@loveliving.uk, www.loveliving.uk</p>'], ['Love Living'], []).confirms).toBe(false);
  });
  it('confirms on the company name, its one-word form or a known full name', () => {
    expect(siteConfirmsCompany(['<h1>Welcome to Love Living</h1>'], ['Love Living'], [])).toEqual({ confirms: true, why: 'name', match: 'love living' });
    expect(siteConfirmsCompany(['<title>LOVELIVING | Hackney</title>'], ['Love Living'], [])).toMatchObject({ confirms: true, match: 'loveliving' });
    expect(siteConfirmsCompany(['<p>Max Whatley, Director</p>'], ['Acme'], [{ first: 'Max', last: 'Whatley' }])).toMatchObject({ confirms: true, why: 'person' });
  });
  it('does not confirm on a surname alone or an unrelated page', () => {
    expect(siteConfirmsCompany(['<p>Mr Whatley says hi</p>'], ['Acme'], [{ first: 'Max', last: 'Whatley' }]).confirms).toBe(false);
    expect(siteConfirmsCompany(['<p>Love is all around</p>'], ['Love Living'], []).confirms).toBe(false);
    expect(siteConfirmsCompany([], ['Love Living'], []).confirms).toBe(false);
  });
  it('writes a fixed line', () => {
    expect(siteConfirmLine('loveliving.uk', { confirms: true, why: 'name', match: 'love living' }))
      .toBe('Domain loveliving.uk: its own website names the company ("love living"), so it is confirmed.');
    expect(siteConfirmLine('x.uk', { confirms: false })).toBeNull();
  });
});

describe('domainEmailsOnPages', () => {
  it('keeps only addresses on that domain', () => {
    expect(domainEmailsOnPages(['<a href="mailto:Max@LoveLiving.uk">x</a> david@loveliving.uk info@gmail.com'], 'loveliving.uk'))
      .toEqual(['max@loveliving.uk', 'david@loveliving.uk']);
  });
});

describe('discovery reads the sites of domains with a mail server for free', () => {
  const input: DiscoveryInput = {
    names: ['Love Living'], people: [{ first: 'Max', last: 'Whatley' }], website: null, websiteDomain: null, known: [],
    allow: { hunter: false, site: false, web: false }, budgetMs: 60_000,
  };
  it('confirms loveliving.uk from its own pages even without Hunter', async () => {
    const deps: DiscoveryDeps = {
      now: () => 0,
      hunterByName: vi.fn(async () => ({ ok: false as const, failure: 'x' })),
      readSite: vi.fn(async () => []),
      webSearch: vi.fn(async () => ({ ok: false as const, failure: 'x' })),
      mx: vi.fn(async (d: string) => (d === 'loveliving.uk' || d === 'lovelivinguk.co.uk' ? 'mx' as const : 'none' as const)),
      readDomainSite: vi.fn(async (d: string) => (d === 'loveliving.uk' ? ['<h2>Our team</h2><p>Max Whatley, Director</p>'] : [])),
    };
    const r = await runDomainDiscovery(input, deps, DOMAIN_CHECKS);
    expect(r.discovered.find((x) => x.domain === 'loveliving.uk')).toMatchObject({ needs_check: false, sources: ['site_confirms'] });
    expect(r.sitePages.map((s) => s.domain)).toEqual(['loveliving.uk']);
    expect(r.problems).toContainEqual({ step: 'site_check', target: 'lovelivinguk.co.uk', failure: 'unreadable' });
  });
});
