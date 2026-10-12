import { describe, expect, it, vi } from 'vitest';
import {
  brandTokens, discoveryDetail, domainFitsBrand, domainHintsFromHtml, domainLabel, domainSharesBrand, hunterNameMatches,
  parseDiscoveryAnswer, rankDomains, runDomainDiscovery, type DiscoveryDeps, type DiscoveryInput,
} from '../../supabase/functions/_shared/domainDiscovery';
import { DOMAIN_CHECKS, savedDomains } from '../../supabase/functions/_shared/domainChecks';

const LOVE = 'Love Living Management Ltd';

describe('brandTokens and domainLabel', () => {
  it('drops generic company words', () => {
    expect(brandTokens(LOVE)).toEqual(['love', 'living']);
    expect(brandTokens('London Management Services Ltd')).toEqual([]);
    expect(brandTokens('Smith & Sons (UK) Group')).toEqual(['smith', 'sons']);
    expect(brandTokens(42)).toEqual([]);
  });

  it('reads the company part of a domain', () => {
    expect(domainLabel('loveliving.uk')).toBe('loveliving');
    expect(domainLabel('mail.love-living.co.uk')).toBe('loveliving');
    expect(domainLabel('lovelivingmanagement.com')).toBe('lovelivingmanagement');
    expect(domainLabel('co.uk')).toBe(null);
  });
});

describe('domainFitsBrand (strict)', () => {
  const brand = brandTokens(LOVE);
  it('accepts domains made only of the brand and generic words', () => {
    expect(domainFitsBrand('loveliving.uk', brand)).toBe(true);
    expect(domainFitsBrand('lovelivingmanagement.com', brand)).toBe(true);
    expect(domainFitsBrand('love-living-group.co.uk', brand)).toBe(true);
  });
  it('refuses domains that add or miss distinctive words', () => {
    expect(domainFitsBrand('livingsocial.com', brand)).toBe(false);
    expect(domainFitsBrand('lovelivingbrands.com', brand)).toBe(false);
    expect(domainFitsBrand('love.com', brand)).toBe(false);
    expect(domainFitsBrand('hokanson.com', ['hok'])).toBe(false);
    expect(domainFitsBrand('hok.com', ['hok'])).toBe(true);
    expect(domainFitsBrand('anything.com', [])).toBe(false);
  });
});

describe('hunterNameMatches (Review Focus 1)', () => {
  it('accepts Love Living Management for loveliving.uk', () => {
    expect(hunterNameMatches([LOVE], 'Love Living', 'loveliving.uk')).toBe(true);
    expect(hunterNameMatches([LOVE], null, 'loveliving.uk')).toBe(true);
  });
  it('rejects an unrelated or bigger company that shares a word', () => {
    expect(hunterNameMatches([LOVE], 'LivingSocial', 'livingsocial.com')).toBe(false);
    expect(hunterNameMatches([LOVE], 'Living Social', 'livingsocial.com')).toBe(false);
    expect(hunterNameMatches([LOVE], 'Love Living Brands Inc', 'loveliving.com')).toBe(false);
    expect(hunterNameMatches(['Love Living'], 'Love Living Furniture', 'lovelivingfurniture.com')).toBe(false);
    expect(hunterNameMatches(['London Management Services'], 'London Management Services', 'londonmanagement.com')).toBe(false);
  });
  it('can match on the registered name instead', () => {
    expect(hunterNameMatches(['LLM Lettings', 'Love Living Management Limited'], 'Love Living', 'loveliving.uk')).toBe(true);
  });
});

describe('domainHintsFromHtml (Review Focus 2)', () => {
  const html = `
    <a href="mailto:david@loveliving.uk">David</a> office@gmail.com
    <p>Partner: info@rightmove.co.uk, bookings@otherfirm.com</p>
    <a href="https://www.facebook.com/loveliving">fb</a>
    <a href="https://love-living.co.uk/careers">jobs</a>
    <a href="https://livingstonelettings.com">friends</a>
    <a href="http://127.0.0.1/admin">x</a>`;
  it('keeps brand-sharing emails on other domains and strictly fitting links only', () => {
    expect(domainHintsFromHtml(html, [LOVE], 'lovelivingmanagement.com', DOMAIN_CHECKS)).toEqual([
      { domain: 'loveliving.uk', source: 'website_email' },
      { domain: 'love-living.co.uk', source: 'website_link' },
    ]);
  });
  it('ignores the website\'s own domain and non-strings', () => {
    expect(domainHintsFromHtml('<a href="mailto:a@lovelivingmanagement.com">', [LOVE], 'lovelivingmanagement.com', DOMAIN_CHECKS)).toEqual([]);
    expect(domainHintsFromHtml(null, [LOVE], null, DOMAIN_CHECKS)).toEqual([]);
  });
  it('shares a brand by containment with the website domain', () => {
    expect(domainSharesBrand('loveliving.uk', [], 'lovelivingmanagement.com')).toBe(true);
    expect(domainSharesBrand('other.uk', [], 'lovelivingmanagement.com')).toBe(false);
  });
});

describe('parseDiscoveryAnswer', () => {
  it('keeps only strictly valid, brand-fitting domains and plain names', () => {
    const text = 'Their site is loveliving.uk. {"websites":["https://www.lovelivingmanagement.com/about","http://169.254.169.254"],"email_domains":["@loveliving.uk","gmail.com","evil.com"],"people":[{"name":"David Cox","role":"Director"},{"name":"<script>","role":"x"},{"name":"Madonna","role":"Owner"}]}';
    expect(parseDiscoveryAnswer(text, [LOVE], DOMAIN_CHECKS)).toEqual({
      domains: ['lovelivingmanagement.com', 'loveliving.uk'],
      people: [{ name: 'David Cox', role: 'Director' }],
    });
  });
  it('returns nothing for odd answers', () => {
    expect(parseDiscoveryAnswer('no json here', [LOVE], DOMAIN_CHECKS)).toEqual({ domains: [], people: [] });
    expect(parseDiscoveryAnswer('{"websites": "loveliving.uk"}', [LOVE], DOMAIN_CHECKS)).toEqual({ domains: [], people: [] });
    expect(parseDiscoveryAnswer(5, [LOVE], DOMAIN_CHECKS)).toEqual({ domains: [], people: [] });
  });
});

describe('rankDomains', () => {
  it('merges sources, ranks, marks web-only domains and keeps at most 4', () => {
    const r = rankDomains([
      { domain: 'web-only-love-living.com', source: 'web' },
      { domain: 'loveliving.uk', source: 'web' },
      { domain: 'loveliving.uk', source: 'hunter_name' },
      { domain: 'lovelivingmanagement.com', source: 'website' },
      { domain: 'gmail.com', source: 'lead_email' },
      { domain: 'a.com', source: 'contact_email' },
      { domain: 'b.com', source: 'contact_email' },
    ], DOMAIN_CHECKS);
    expect(r).toEqual([
      { domain: 'lovelivingmanagement.com', sources: ['website'], needs_check: false },
      { domain: 'a.com', sources: ['contact_email'], needs_check: false },
      { domain: 'b.com', sources: ['contact_email'], needs_check: false },
      { domain: 'loveliving.uk', sources: ['hunter_name', 'web'], needs_check: false },
    ]);
  });
  it('describes what was found without naming web-only domains as fact', () => {
    expect(discoveryDetail([
      { domain: 'loveliving.uk', sources: ['hunter_name'], needs_check: false },
      { domain: 'x.com', sources: ['web'], needs_check: true },
    ])).toBe('Looked for the company\'s other domains: found loveliving.uk; 1 more from a web search, used for searching only.');
    expect(discoveryDetail([])).toBe('Looked for the company\'s other domains but found none.');
  });
});

describe('savedDomains', () => {
  it('re-checks every stored value', () => {
    expect(savedDomains(['LoveLiving.uk', 'gmail.com', 'localhost', 'facebook.com', 5, 'loveliving.uk'])).toEqual(['loveliving.uk']);
    expect(savedDomains('loveliving.uk')).toEqual([]);
  });
});

describe('runDomainDiscovery', () => {
  const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
    names: [LOVE], website: 'https://lovelivingmanagement.com', websiteDomain: 'lovelivingmanagement.com',
    known: [{ domain: 'lovelivingmanagement.com', source: 'website' }],
    allow: { hunter: true, site: true, web: true }, budgetMs: 30_000, ...over,
  });
  const deps = (over: Partial<DiscoveryDeps> = {}): DiscoveryDeps => ({
    now: () => 0,
    hunterByName: vi.fn(async () => ({ ok: true as const, domain: 'loveliving.uk', organization: 'Love Living' })),
    readSite: vi.fn(async () => []),
    webSearch: vi.fn(async () => ({ ok: true as const, text: '{"websites":[],"email_domains":["lovelivingmgmt-love-living.com"],"people":[{"name":"David Cox","role":"Director"}]}' })),
    ...over,
  });

  it('finds the Love Living domain by company name and counts calls', async () => {
    const r = await runDomainDiscovery(input(), deps(), DOMAIN_CHECKS);
    expect(r.discovered.map((d) => d.domain)).toEqual(['loveliving.uk']);
    expect(r.domains[0]!.domain).toBe('lovelivingmanagement.com');
    expect(r.people).toEqual([{ name: 'David Cox', role: 'Director' }]);
    expect(r).toMatchObject({ hunterCalls: 1, aiCalls: 1, failures: [] });
  });

  it('refuses Hunter\'s answer for an unrelated company and keeps going after failures', async () => {
    const r = await runDomainDiscovery(input(), deps({
      hunterByName: vi.fn(async () => ({ ok: true as const, domain: 'livingsocial.com', organization: 'LivingSocial' })),
      webSearch: vi.fn(async () => ({ ok: false as const, failure: 'timeout' })),
      readSite: vi.fn(async () => ['<a href="mailto:jo@loveliving.uk">Jo</a>']),
    }), DOMAIN_CHECKS);
    expect(r.discovered).toEqual([{ domain: 'loveliving.uk', sources: ['website_email'], needs_check: false }]);
    expect(r.failures).toEqual(['web:timeout']);
  });

  it('runs nothing that is not allowed or has no time', async () => {
    const d = deps();
    const r = await runDomainDiscovery(input({ allow: { hunter: false, site: true, web: true }, budgetMs: 2_000 }), d, DOMAIN_CHECKS);
    expect(d.hunterByName).not.toHaveBeenCalled();
    expect(d.readSite).not.toHaveBeenCalled();
    expect(d.webSearch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ hunterCalls: 0, aiCalls: 0, discovered: [] });
  });
});
