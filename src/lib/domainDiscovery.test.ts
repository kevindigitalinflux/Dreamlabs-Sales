import { describe, expect, it, vi } from 'vitest';
import {
  brandTokens, discoveryDetail, distinctiveTokens, domainFitsBrand, domainFitsNames, domainHintsFromHtml, domainLabel,
  hunterNameMatches, isCorroborated,
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
  it('is strong only when Hunter agrees with the Companies House registered name', () => {
    expect(hunterNameMatches([LOVE], 'Love Living', 'loveliving.uk', 'LOVE LIVING MANAGEMENT LIMITED')).toBe('strong');
    expect(hunterNameMatches([LOVE], 'Love Living', 'loveliving.uk')).toBe('weak');
  });
  it('never accepts lovelivinguk.co.uk for Love Living on the name alone (live case)', () => {
    expect(hunterNameMatches(['Love Living'], 'Love Living UK', 'lovelivinguk.co.uk')).toBe('weak');
    expect(isCorroborated(['hunter_name_weak'])).toBe(false);
  });
  it('is only weak without an organisation name or for a one-word brand', () => {
    expect(hunterNameMatches([LOVE], null, 'loveliving.uk')).toBe('weak');
    expect(hunterNameMatches(['Bloom Ltd'], 'Bloom', 'bloom.com')).toBe('weak');
    expect(hunterNameMatches(['Sparkle Cleaning Services'], 'Sparkle Cleaning', 'sparklecleaning.co.uk')).toBe('weak');
  });
  it('rejects an unrelated or bigger company that shares a word', () => {
    expect(hunterNameMatches([LOVE], 'LivingSocial', 'livingsocial.com')).toBe('none');
    expect(hunterNameMatches([LOVE], 'Living Social', 'livingsocial.com')).toBe('none');
    expect(hunterNameMatches([LOVE], 'Love Living Brands Inc', 'loveliving.com')).toBe('none');
    expect(hunterNameMatches(['Love Living'], 'Love Living Furniture', 'lovelivingfurniture.com')).toBe('none');
    expect(hunterNameMatches(['London Management Services'], 'London Management Services', 'londonmanagement.com')).toBe('none');
    expect(hunterNameMatches(['London Cleaning Services'], 'London Cleaning', 'londoncleaning.com')).toBe('none');
  });
  it('can match on the registered name instead', () => {
    expect(hunterNameMatches(['LLM Lettings', 'Love Living Management Limited'], 'Love Living', 'loveliving.uk', 'Love Living Management Limited')).toBe('strong');
  });
});

describe('domainFitsNames (strict, distinctive words)', () => {
  it('needs every distinctive word in full, industry words never count', () => {
    expect(distinctiveTokens('Sparkle Cleaning Services Ltd')).toEqual(['sparkle']);
    expect(domainFitsNames('sparklecleaning.co.uk', ['Sparkle Cleaning'])).toBe(true);
    expect(domainFitsNames('sparkle.co.uk', ['Sparkle Cleaning'])).toBe(true);
    expect(domainFitsNames('cleaningwebdesigns.co.uk', ['Sparkle Cleaning'])).toBe(false);
    expect(domainFitsNames('sparklewebdesigns.co.uk', ['Sparkle Cleaning'])).toBe(false);
    expect(domainFitsNames('cleaning.co.uk', ['London Cleaning Services'])).toBe(false);
    expect(domainFitsNames('lovelivingmanagement.com', [LOVE])).toBe(true);
  });
});

describe('domainHintsFromHtml (Review Focus 2)', () => {
  const html = `
    <a href="mailto:david@loveliving.uk">David</a> office@gmail.com
    <p>Partner: info@rightmove.co.uk, bookings@otherfirm.com, hello@lovewebdesigns.co.uk</p>
    <a href="https://www.facebook.com/loveliving">fb</a>
    <a href="https://love-living.co.uk/careers">jobs</a>
    <a href="https://livingstonelettings.com">friends</a>
    <a href="http://127.0.0.1/admin">x</a>`;
  it('keeps emails and links on other domains only on a strict brand fit', () => {
    expect(domainHintsFromHtml(html, [LOVE], 'lovelivingmanagement.com', DOMAIN_CHECKS)).toEqual([
      { domain: 'loveliving.uk', source: 'website_email' },
      { domain: 'love-living.co.uk', source: 'website_link' },
    ]);
  });
  it('refuses a supplier credit that only shares an industry word', () => {
    const credit = '<footer>Site by <a href="mailto:hello@cleaningwebdesigns.co.uk">us</a></footer>';
    expect(domainHintsFromHtml(credit, ['Sparkle Cleaning'], 'sparkle-cleaning.com', DOMAIN_CHECKS)).toEqual([]);
  });
  it('ignores the website\'s own domain and non-strings', () => {
    expect(domainHintsFromHtml('<a href="mailto:a@lovelivingmanagement.com">', [LOVE], 'lovelivingmanagement.com', DOMAIN_CHECKS)).toEqual([]);
    expect(domainHintsFromHtml(null, [LOVE], null, DOMAIN_CHECKS)).toEqual([]);
  });
});

describe('isCorroborated', () => {
  it('needs one strong source or two different weak signals', () => {
    expect(isCorroborated(['website'])).toBe(true);
    expect(isCorroborated(['hunter_name'])).toBe(true);
    expect(isCorroborated(['hunter_name_weak'])).toBe(false);
    expect(isCorroborated(['web'])).toBe(false);
    expect(isCorroborated(['website_email'])).toBe(false);
    expect(isCorroborated(['hunter_name_weak', 'website_email'])).toBe(true);
    expect(isCorroborated(['web', 'website_link'])).toBe(true);
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
    ])).toBe('Looked for the company\'s other domains: found loveliving.uk; 1 more seen only once, used for searching only.');
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

  it('skips company-name credits when the lead already has a confirmed website', async () => {
    const r = await runDomainDiscovery(input(), deps(), DOMAIN_CHECKS);
    expect(r.discovered).toEqual([]);
    expect(r.domains[0]!.domain).toBe('lovelivingmanagement.com');
    expect(r.people).toEqual([{ name: 'David Cox', role: 'Director' }]);
    expect(r).toMatchObject({ hunterCalls: 0, aiCalls: 1, problems: [] });
  });

  it('refuses Hunter\'s answer for an unrelated company and keeps going after failures', async () => {
    const r = await runDomainDiscovery(input(), deps({
      hunterByName: vi.fn(async () => ({ ok: true as const, domain: 'livingsocial.com', organization: 'LivingSocial' })),
      webSearch: vi.fn(async () => ({ ok: false as const, failure: 'timeout' })),
      readSite: vi.fn(async () => ['<a href="mailto:jo@loveliving.uk">Jo</a>']),
    }), DOMAIN_CHECKS);
    // One weak signal only: searched, but not corroborated.
    expect(r.discovered).toEqual([{ domain: 'loveliving.uk', sources: ['website_email'], needs_check: true }]);
    expect(r.problems).toEqual([{ step: 'web', target: 'company', failure: 'timeout' }]);
  });

  it('accepts a weak Hunter match only with a second signal', async () => {
    const weak = deps({ hunterByName: vi.fn(async () => ({ ok: true as const, domain: 'loveliving.uk', organization: null })), webSearch: vi.fn(async () => ({ ok: false as const, failure: 'timeout' })) });
    const alone = await runDomainDiscovery(input({ known: [] }), weak, DOMAIN_CHECKS);
    expect(alone.discovered).toEqual([{ domain: 'loveliving.uk', sources: ['hunter_name_weak'], needs_check: true }]);
    const backed = await runDomainDiscovery(input({ known: [] }), { ...weak, readSite: vi.fn(async () => ['<a href="mailto:jo@loveliving.uk">Jo</a>']) }, DOMAIN_CHECKS);
    expect(backed.discovered).toEqual([{ domain: 'loveliving.uk', sources: ['hunter_name_weak', 'website_email'], needs_check: false }]);
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
