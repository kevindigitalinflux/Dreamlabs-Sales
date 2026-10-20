import { describe, expect, it, vi } from 'vitest';
import {
  candidateDomainsFromNames, listNamesKnownPerson, parseDohMx, runDomainDiscovery, websiteSuspicion,
  type DiscoveryDeps, type DiscoveryInput,
} from '../../supabase/functions/_shared/domainDiscovery';
import { DOMAIN_CHECKS } from '../../supabase/functions/_shared/domainChecks';

describe('candidateDomainsFromNames', () => {
  it('builds plausible domains from the name, capped at 12', () => {
    const c = candidateDomainsFromNames(['Love Living', 'LOVE LIVING MANAGEMENT LIMITED']);
    expect(c.slice(0, 3)).toEqual(['loveliving.uk', 'loveliving.co.uk', 'loveliving.com']);
    expect(c).toContain('lovelivinguk.co.uk');
    expect(c).toContain('loveliving.london');
    expect(c.length).toBeLessThanOrEqual(12);
    expect(candidateDomainsFromNames(['London Cleaning Services'])).toEqual([]);
  });
});

describe('parseDohMx', () => {
  it('reads Cloudflare DoH JSON defensively', () => {
    expect(parseDohMx({ Status: 0, Answer: [{ type: 15, data: '10 mx1.loveliving.uk.' }] })).toBe('mx');
    expect(parseDohMx({ Status: 3 })).toBe('none');
    expect(parseDohMx({ Status: 0, Answer: [{ type: 15, data: '0 .' }] })).toBe('none');
    expect(parseDohMx({ Status: 0, Answer: [{ type: 5, data: 'x.' }] })).toBe('none');
    expect(parseDohMx({ Status: 2 })).toBe('error');
    expect(parseDohMx('nope')).toBe('error');
  });
});

describe('listNamesKnownPerson', () => {
  it('confirms a domain when a known person is on Hunter\'s list', () => {
    const emails = [{ value: 'max@loveliving.uk', first_name: 'Max', last_name: 'Whatley' }, 'x', null];
    expect(listNamesKnownPerson(emails, [{ first: 'Max', last: 'Whatley' }])).toBe(true);
    expect(listNamesKnownPerson(emails, [{ first: 'John', last: 'Sipple' }])).toBe(false);
    expect(listNamesKnownPerson('nope', [{ first: 'Max', last: 'Whatley' }])).toBe(false);
  });
});

describe('websiteSuspicion', () => {
  it('flags a site with only US phone numbers', () => {
    const us = '<title>Love Living Management</title><p>Call +1 (305) 555-0100</p>';
    expect(websiteSuspicion([us], ['Love Living'])).toEqual({ suspect: true, reasons: ['The phone numbers on the website are not UK numbers.'] });
  });
  it('flags a title and footer naming another business', () => {
    const other = '<title>Jurny Stays</title><footer>© 2026 Jurny Inc</footer>';
    expect(websiteSuspicion([other], ['Love Living']).reasons).toEqual(['The website title and footer name a different business.']);
  });
  it('is quiet for a normal UK site', () => {
    const ok = '<title>Love Living | Hackney lettings</title><p>Call 020 7946 0000 or +44 20 7946 0000</p>';
    expect(websiteSuspicion([ok], ['Love Living'])).toEqual({ suspect: false, reasons: [] });
    expect(websiteSuspicion([], ['Love Living']).suspect).toBe(false);
  });
});

describe('runDomainDiscovery v2 (Review Focus 3 and 4)', () => {
  const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
    names: ['Love Living'], registeredName: null, people: [{ first: 'Max', last: 'Whatley' }],
    website: null, websiteDomain: null, known: [], allow: { hunter: true, site: false, web: false }, budgetMs: 60_000, ...over,
  });
  const base = (over: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
    now: () => 0,
    hunterByName: vi.fn(async () => ({ ok: true as const, domain: 'lovelivinguk.co.uk', organization: 'Love Living UK' })),
    readSite: vi.fn(async () => []),
    webSearch: vi.fn(async () => ({ ok: false as const, failure: 'x' })),
    mx: vi.fn(async (d: string) => (d === 'loveliving.uk' || d === 'loveliving.com' ? 'mx' as const : 'none' as const)),
    hunterList: vi.fn(async (d: string) => (d === 'loveliving.uk'
      ? { ok: true as const, organization: 'Love Living', emails: [{ value: 'max@loveliving.uk', first_name: 'Max', last_name: 'Whatley' }] }
      : { ok: true as const, organization: 'Love Living Inc', emails: [] })),
    hunterFindByCompany: vi.fn(async () => ({ ok: true as const, email: null, score: 0 })),
    ...over,
  });

  it('does not accept the Hunter name hit alone, but confirms the domain where a known person is listed', async () => {
    const r = await runDomainDiscovery(input(), base(), DOMAIN_CHECKS);
    const byDomain = Object.fromEntries(r.domains.map((d) => [d.domain, d]));
    expect(byDomain['lovelivinguk.co.uk']).toMatchObject({ needs_check: true, sources: ['hunter_name_weak'] });
    expect(byDomain['loveliving.uk']).toMatchObject({ needs_check: false, sources: ['person_confirmed'] });
    // MX but no known person and only a similar Hunter name: kept for searching, never confirmed (Review Focus 3).
    expect(byDomain['loveliving.com']).toBeUndefined(); // Stop paid discovery once a domain is confirmed.
    expect(r.notes.some((n) => n.includes('loveliving.uk'))).toBe(true);
  });

  it('accepts a domain where Hunter email-finder by company name finds a known person', async () => {
    const r = await runDomainDiscovery(input(), base({
      hunterFindByCompany: vi.fn(async () => ({ ok: true as const, email: 'max@loveliving.uk', score: 91 })),
      mx: vi.fn(async () => 'none' as const),
    }), DOMAIN_CHECKS);
    expect(r.discovered.find((d) => d.domain === 'loveliving.uk')).toMatchObject({ needs_check: false, sources: ['person_confirmed'] });
  });

  it('ignores a low-score finder result and blocked domains, and stops at the credit cap', async () => {
    const capped = base({
      hunterByName: vi.fn(async () => ({ ok: false as const, failure: 'cap_reached' })),
      hunterFindByCompany: vi.fn(async () => ({ ok: true as const, email: 'max@loveliving.uk', score: 10 })),
    });
    const r = await runDomainDiscovery(input({ blocked: ['loveliving.uk'] }), capped, DOMAIN_CHECKS);
    expect(capped.hunterFindByCompany).not.toHaveBeenCalled();
    expect(capped.hunterList).not.toHaveBeenCalled();
    expect(r.domains).toEqual([]);
  });

  it('never reads a suspect website for other domains', async () => {
    const d = base();
    await runDomainDiscovery(input({ allow: { hunter: false, site: true, web: false }, website: 'https://x.com', websiteDomain: 'x.com', websiteSuspect: true }), d, DOMAIN_CHECKS);
    expect(d.readSite).not.toHaveBeenCalled();
  });
});
