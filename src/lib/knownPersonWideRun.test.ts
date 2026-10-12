import { describe, expect, it, vi } from 'vitest';
import { runWideLookup, type WideLookupDeps, type WideLookupInput } from '../../supabase/functions/_shared/knownPersonWideRun';
import type { FoundFields } from '../../supabase/functions/_shared/knownPerson';
import type { StepId } from '../../supabase/functions/_shared/knownPersonWide';

const input = (over: Partial<WideLookupInput> = {}): WideLookupInput => ({
  first: 'John', last: 'Sipple',
  have: { email: null, linkedin_url: null, phone: null },
  hasApolloId: false, domains: ['x.com'], website: 'https://x.com', websiteDirectory: false, usePaid: true,
  keys: { hunter: true, apollo: true, gemini: true },
  ...over,
});

/** Fakes that find nothing; `absorb` fills blanks like the real flow and records which step filled what. */
function deps(over: Partial<WideLookupDeps> = {}) {
  const filled: { found: FoundFields; step: StepId }[] = [];
  const have: FoundFields = {};
  const d: WideLookupDeps = {
    now: () => 0,
    takeSlot: vi.fn(async () => true),
    hunterFind: vi.fn(async () => ({ ok: true as const, found: {} })),
    hunterDomain: vi.fn(async () => ({ ok: true as const, emails: [], pattern: null })),
    hunterVerify: vi.fn(async () => ({ ok: true as const, verdict: 'unverified' as const })),
    scanWebsite: vi.fn(async () => ({ ok: true as const, email: null, linkedin_url: null })),
    webSearch: vi.fn(async () => ({ ok: true as const, found: {} })),
    apolloMatch: vi.fn(async () => ({ ok: true as const, found: {} })),
    absorb: (found, step) => {
      const applied: FoundFields = {};
      for (const f of ['email', 'linkedin_url', 'phone'] as const) {
        if (found[f] && !have[f]) { have[f] = found[f]; applied[f] = found[f]; }
      }
      if (Object.keys(applied).length) filled.push({ found: applied, step });
      return applied;
    },
    ...over,
  };
  return { d, filled };
}
const statuses = (steps: { id: string; status: string }[]) => Object.fromEntries(steps.map((s) => [s.id, s.status]));

describe('runWideLookup', () => {
  it('runs every step in order and reports each one', async () => {
    const { d } = deps();
    const r = await runWideLookup(input(), d);
    expect(r.steps.map((s) => s.id)).toEqual(['hunter_finder', 'hunter_domain', 'pattern', 'website', 'apollo', 'web']);
    expect(statuses(r.steps)).toEqual({
      hunter_finder: 'no_match', hunter_domain: 'no_match', pattern: 'no_match', website: 'no_match', web: 'no_match', apollo: 'no_match',
    });
    expect(r.steps[1]!.detail).toBe('Hunter searched x.com and found no one called Sipple.');
    expect(d.takeSlot).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ hunterCalled: true, apolloCalled: true, limitReached: false, suggestions: [] });
  });

  it('fills email and LinkedIn from the company list and skips later steps', async () => {
    const { d, filled } = deps({
      hunterDomain: vi.fn(async () => ({ ok: true as const, pattern: '{first}', emails: [
        { value: 'john.sipple@x.com', first_name: 'John', last_name: 'Sipple', linkedin: 'https://www.linkedin.com/in/jsipple' },
      ] })),
    });
    const r = await runWideLookup(input(), d);
    expect(filled).toEqual([{ step: 'hunter_domain', found: { email: 'john.sipple@x.com', linkedin_url: 'https://www.linkedin.com/in/jsipple' } }]);
    expect(statuses(r.steps)).toMatchObject({ hunter_domain: 'found', pattern: 'skipped', website: 'skipped', web: 'skipped', apollo: 'skipped' });
    expect(d.scanWebsite).not.toHaveBeenCalled();
    expect(d.apolloMatch).not.toHaveBeenCalled();
  });

  it('saves a verified pattern address, but only suggests an unverified one', async () => {
    const list = vi.fn(async () => ({ ok: true as const, emails: [], pattern: '{first}.{last}' }));
    const verified = deps({ hunterDomain: list, hunterVerify: vi.fn(async () => ({ ok: true as const, verdict: 'verified' as const })) });
    const r1 = await runWideLookup(input(), verified.d);
    expect(verified.filled[0]).toEqual({ step: 'pattern', found: { email: 'john.sipple@x.com' } });
    expect(r1.suggestions).toEqual([]);

    const unverified = deps({ hunterDomain: list });
    const r2 = await runWideLookup(input(), unverified.d);
    expect(unverified.filled).toEqual([]);
    expect(r2.suggestions).toEqual([{ field: 'email', value: 'john.sipple@x.com', label: 'Guess, unverified' }]);

    const invalid = deps({ hunterDomain: list, hunterVerify: vi.fn(async () => ({ ok: true as const, verdict: 'invalid' as const })) });
    const r3 = await runWideLookup(input(), invalid.d);
    expect(r3.suggestions).toEqual([]);
    expect(statuses(r3.steps).pattern).toBe('no_match');
  });

  it('drops the unverified guess when a later step saves a real address', async () => {
    const { d } = deps({
      hunterDomain: vi.fn(async () => ({ ok: true as const, emails: [], pattern: '{f}{last}' })),
      scanWebsite: vi.fn(async () => ({ ok: true as const, email: 'john@x.com', linkedin_url: null })),
    });
    const r = await runWideLookup(input(), d);
    expect(r.suggestions).toEqual([]);
    expect(statuses(r.steps).website).toBe('found');
  });

  it('never saves web-search finds: they become suggestions', async () => {
    const { d, filled } = deps({
      webSearch: vi.fn(async () => ({ ok: true as const, found: { email: 'john.sipple@x.com', linkedin_url: 'https://www.linkedin.com/in/js' } })),
    });
    const r = await runWideLookup(input(), d);
    expect(filled).toEqual([]);
    expect(r.suggestions).toEqual([
      { field: 'email', value: 'john.sipple@x.com', label: 'Found by web search, check it' },
      { field: 'linkedin_url', value: 'https://www.linkedin.com/in/js', label: 'Found by web search, check it' },
    ]);
  });

  it('ignores a found address on another domain', async () => {
    const { d, filled } = deps({
      hunterFind: vi.fn(async () => ({ ok: true as const, found: { email: 'john@gmail.com' } })),
      scanWebsite: vi.fn(async () => ({ ok: true as const, email: 'john@other.com', linkedin_url: null })),
      webSearch: vi.fn(async () => ({ ok: true as const, found: { email: 'john@other.com' } })),
    });
    const r = await runWideLookup(input(), d);
    expect(filled).toEqual([]);
    expect(r.suggestions).toEqual([]);
  });

  it('turns a failing or throwing step into a status and carries on', async () => {
    const { d } = deps({
      hunterFind: vi.fn(async () => ({ ok: false as const, failure: 401 })),
      hunterDomain: vi.fn(async () => { throw new Error('boom'); }),
      scanWebsite: vi.fn(async () => ({ ok: false as const })),
      webSearch: vi.fn(async () => ({ ok: false as const, failure: 'timeout' as const })),
      apolloMatch: vi.fn(async () => ({ ok: true as const, found: { phone: '+44 20 7946 0000' } })),
    });
    const r = await runWideLookup(input(), d);
    expect(statuses(r.steps)).toEqual({
      hunter_finder: 'error', hunter_domain: 'error', pattern: 'skipped', website: 'error', web: 'error', apollo: 'found',
    });
    expect(r.steps[0]!.detail).toContain('Hunter did not accept the saved API key');
  });

  it('treats Apollo refusing the plan as a quiet unavailable step', async () => {
    for (const [failure, detail] of [[403, 'Apollo is not available on this plan, so it was skipped.'], [402, 'Apollo is not available on this plan, so it was skipped.'], [401, 'Apollo did not accept the saved key, so it was skipped.']] as const) {
      const { d } = deps({ apolloMatch: vi.fn(async () => ({ ok: false as const, failure })) });
      const r = await runWideLookup(input(), d);
      expect(r.steps.find((x) => x.id === 'apollo')).toMatchObject({ status: 'unavailable', detail });
    }
  });

  it('skips steps 2 to 5 for a directory website, without using a slot when nothing can run', async () => {
    const { d } = deps();
    const r = await runWideLookup(input({ domains: [], website: null, websiteDirectory: true }), d);
    expect(r.steps.every((s) => s.status === 'skipped')).toBe(true);
    expect(r.steps[1]!.detail).toBe('The lead\'s website is a social or directory page, so it was not searched.');
    expect(d.takeSlot).not.toHaveBeenCalled();
  });

  it('only reads the website when paid lookups are off', async () => {
    const { d } = deps();
    const r = await runWideLookup(input({ usePaid: false }), d);
    expect(statuses(r.steps)).toEqual({
      hunter_finder: 'skipped', hunter_domain: 'skipped', pattern: 'skipped', website: 'no_match', web: 'skipped', apollo: 'skipped',
    });
    expect(d.takeSlot).toHaveBeenCalledTimes(1);
  });

  it('marks missing keys as unavailable', async () => {
    const { d } = deps();
    const r = await runWideLookup(input({ keys: { hunter: false, apollo: false, gemini: false } }), d);
    expect(statuses(r.steps)).toMatchObject({ hunter_finder: 'unavailable', web: 'unavailable', apollo: 'unavailable', website: 'no_match' });
  });

  it('runs nothing when the daily limit is reached', async () => {
    const { d } = deps({ takeSlot: vi.fn(async () => false) });
    const r = await runWideLookup(input(), d);
    expect(r.limitReached).toBe(true);
    expect(r.steps.every((s) => s.status === 'skipped')).toBe(true);
    expect(d.hunterFind).not.toHaveBeenCalled();
  });

  it('skips the rest once the time budget is used up', async () => {
    let t = 0;
    const { d } = deps({ now: () => t, hunterFind: vi.fn(async () => { t += 19_000; return { ok: true as const, found: {} }; }) });
    const r = await runWideLookup(input(), d);
    // The web search runs last on its own extra time, so it is not starved by the slow first step.
    expect(statuses(r.steps)).toMatchObject({ hunter_domain: 'skipped', website: 'skipped', apollo: 'skipped', web: 'no_match' });
    expect(r.steps[1]!.detail).toBe('Skipped to keep the lookup quick.');
    expect(d.webSearch).toHaveBeenCalledWith(11_000);
  });

  it('does not run Hunter when the person already has an email, but still looks for LinkedIn', async () => {
    const { d } = deps();
    const r = await runWideLookup(input({ have: { email: 'john@x.com', linkedin_url: null, phone: null } }), d);
    expect(statuses(r.steps)).toMatchObject({ hunter_finder: 'skipped', hunter_domain: 'no_match', pattern: 'skipped', website: 'no_match' });
    expect(d.hunterFind).not.toHaveBeenCalled();
  });
});

describe('runWideLookup across several company domains', () => {
  const loveLiving = (over: Partial<WideLookupInput> = {}) => input({
    first: 'Max', last: 'Whatley', domains: ['lovelivingmanagement.com', 'loveliving.uk'],
    website: 'https://lovelivingmanagement.com',
    knownAddresses: [{ email: 'david@loveliving.uk', first: 'David', last: null }],
    ...over,
  });

  it('runs the Hunter steps per domain, labelled with the domain, and stops once the email is found', async () => {
    const { d, filled } = deps({
      hunterDomain: vi.fn(async (domain: string) => (domain === 'loveliving.uk'
        ? { ok: true as const, pattern: null, emails: [{ value: 'max@loveliving.uk', first_name: 'Max', last_name: 'Whatley' }] }
        : { ok: true as const, pattern: null, emails: [] })),
    });
    const r = await runWideLookup(loveLiving({ domains: ['lovelivingmanagement.com', 'loveliving.uk', 'third.co.uk'] }), d);
    expect(r.steps.slice(0, 6).map((s) => s.label)).toEqual([
      'Hunter email finder (lovelivingmanagement.com)', 'Hunter company list (lovelivingmanagement.com)', 'Company email pattern (lovelivingmanagement.com)',
      'Hunter email finder (loveliving.uk)', 'Hunter company list (loveliving.uk)', 'Company email pattern (loveliving.uk)',
    ]);
    expect(filled[0]).toEqual({ step: 'hunter_domain', found: { email: 'max@loveliving.uk' } });
    expect(d.hunterFind).toHaveBeenCalledTimes(2);
    expect(r.steps.some((s) => s.domain === 'third.co.uk')).toBe(false);
  });

  it('learns the pattern from another contact on the same domain and verifies the built address', async () => {
    const { d, filled } = deps({ hunterVerify: vi.fn(async () => ({ ok: true as const, verdict: 'verified' as const })) });
    const r = await runWideLookup(loveLiving(), d);
    expect(d.hunterVerify).toHaveBeenCalledWith('max@loveliving.uk', expect.any(Number));
    expect(filled).toEqual([{ step: 'pattern', found: { email: 'max@loveliving.uk' } }]);
    const step = r.steps.find((s) => s.id === 'pattern' && s.domain === 'loveliving.uk');
    expect(step?.detail).toBe('Built from the pattern of another address on this domain (loveliving.uk) and Hunter verified it.');
  });

  it('offers an unverified learned address as a guess', async () => {
    const { d } = deps();
    const r = await runWideLookup(loveLiving(), d);
    expect(r.suggestions).toEqual([{ field: 'email', value: 'max@loveliving.uk', label: 'Guess, unverified' }]);
  });

  it('accepts a website or web-search email on any company domain, never another one', async () => {
    const site = deps({ scanWebsite: vi.fn(async () => ({ ok: true as const, email: 'max.whatley@loveliving.uk', linkedin_url: null })) });
    await runWideLookup(loveLiving({ knownAddresses: [] }), site.d);
    expect(site.filled).toEqual([{ step: 'website', found: { email: 'max.whatley@loveliving.uk' } }]);
    expect(site.d.scanWebsite).toHaveBeenCalledWith('https://lovelivingmanagement.com', ['lovelivingmanagement.com', 'loveliving.uk'], 'Max', 'Whatley', expect.any(Number));

    const web = deps({ webSearch: vi.fn(async () => ({ ok: true as const, found: { email: 'max@gmail.com' } })) });
    const r = await runWideLookup(loveLiving({ knownAddresses: [] }), web.d);
    expect(r.suggestions).toEqual([]);
  });

  it('uses the first domain for Apollo and caps the run at three domains', async () => {
    const { d } = deps();
    await runWideLookup(loveLiving({ domains: ['a.com', 'b.com', 'c.com', 'd.com'], knownAddresses: [] }), d);
    expect(d.hunterFind).toHaveBeenCalledTimes(3);
    expect(d.apolloMatch).toHaveBeenCalledWith('a.com', 'Max', 'Whatley', expect.any(Number));
  });

  it('says there is no domain to search when there is none', async () => {
    const { d } = deps();
    const r = await runWideLookup(input({ domains: [], website: null }), d);
    expect(r.steps[0]).toMatchObject({ id: 'hunter_finder', status: 'skipped', detail: expect.stringContaining('No company domain to search') });
  });
});

describe('runWideLookup readable failures', () => {
  it('skips the web search with a pointer to Deep find when even its extra time is gone', async () => {
    let t = 0;
    const { d } = deps({ now: () => t, hunterFind: vi.fn(async () => { t += 27_000; return { ok: true as const, found: {} }; }) });
    const r = await runWideLookup(input(), d);
    expect(r.steps.find((s) => s.id === 'web')).toMatchObject({
      status: 'skipped', detail: 'Skipped to keep the lookup quick: use Deep find for a longer search.',
    });
    expect(d.webSearch).not.toHaveBeenCalled();
  });

  it('says why the web search failed, with a safe reason code', async () => {
    const cases = [
      ['timeout', 'The web search ran out of time.', 'timeout'],
      [429, 'Gemini refused the request (error 429, try again later).', 'rate_limited'],
      [403, 'Gemini refused the request (error 403): check the Gemini key saved for this organisation.', 'provider_refused_403'],
      ['bad_reply', 'Gemini sent a reply that could not be read.', 'bad_reply'],
      ['network', 'Gemini could not be reached for the web search.', 'network'],
    ] as const;
    for (const [failure, detail, reason] of cases) {
      const { d } = deps({ webSearch: vi.fn(async () => ({ ok: false as const, failure })) });
      const r = await runWideLookup(input(), d);
      expect(r.steps.find((s) => s.id === 'web')).toMatchObject({ status: 'error', detail, reason });
    }
  });

  it('tags missing keys and provider refusals', async () => {
    const { d } = deps({ hunterFind: vi.fn(async () => ({ ok: false as const, failure: 401 })) });
    const r = await runWideLookup(input({ keys: { hunter: true, apollo: true, gemini: false } }), d);
    expect(r.steps[0]).toMatchObject({ status: 'error', reason: 'provider_refused_401' });
    expect(r.steps.find((s) => s.id === 'web')).toMatchObject({
      status: 'unavailable', reason: 'no_key', detail: 'No Gemini key is set for this organisation.',
    });
  });
});
