import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/websiteContact', () => ({ scrapeWebsiteContact: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ lookupCompaniesHouseOfficer: vi.fn() }));
vi.mock('../../supabase/functions/_shared/openCorporates', () => ({ lookupOpenCorporatesOfficer: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloHunterLookup', () => ({ lookupApolloPhone: vi.fn(), lookupHunterEmail: vi.fn(), lookupHunterOwnerEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/googlePlacesLookup', () => ({ lookupPlaceContact: vi.fn() }));
import { scrapeWebsiteContact } from '../../supabase/functions/_shared/websiteContact';
import { lookupHunterEmail, lookupHunterOwnerEmail } from '../../supabase/functions/_shared/apolloHunterLookup';
import { lookupPlaceContact } from '../../supabase/functions/_shared/googlePlacesLookup';
import { lookupCompaniesHouseOfficer } from '../../supabase/functions/_shared/companiesHouse';
import { enrichOneLead } from '../../supabase/functions/_shared/enrichLead';
const lead = { id: 'lead', org_id: 'org', business_name: 'Example', website: 'https://example.com', email: null, phone: null, owner_name: null, city: null };
const keys = { companiesHouse: null, openCorporates: null, apollo: null, hunter: null, googlePlaces: null };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(scrapeWebsiteContact).mockResolvedValue({ email: null, phone: null }); });
it('uses one fallback before paid email lookup and preserves its proposal source', async () => {
  const fallback = vi.fn().mockResolvedValue({ email: 'hello@example.com', phone: '+44 1234567890' });
  expect(await enrichOneLead(lead, { ...keys, hunter: 'test' }, { siteFallback: fallback })).toEqual({
    lead_id: 'lead', proposed: { email: 'hello@example.com', phone: '+44 1234567890' }, source: { email: 'browser scraper', phone: 'browser scraper' },
  });
  expect(fallback).toHaveBeenCalledExactlyOnceWith(lead.website);
  expect(lookupHunterEmail).not.toHaveBeenCalled();
});
it.each([{ email: 'a@example.com', phone: null }, { email: null, phone: '1234567890' }])('does not scrape when the free reader finds a contact: %j', async (contact) => {
  vi.mocked(scrapeWebsiteContact).mockResolvedValue(contact);
  const fallback = vi.fn();
  await enrichOneLead(lead, keys, { siteFallback: fallback });
  expect(fallback).not.toHaveBeenCalled();
});
it('continues to existing lookups when the worker is unavailable', async () => {
  vi.mocked(lookupHunterEmail).mockResolvedValue('hunter@example.com');
  const result = await enrichOneLead(lead, { ...keys, hunter: 'test' }, { siteFallback: vi.fn().mockResolvedValue(null) });
  expect(result?.source.email).toBe('hunter');
});
it('keeps the original path when no fallback is provided', async () => {
  expect(await enrichOneLead(lead, keys)).toBeNull();
});
it('never sends a Google Places website proposal to the worker', async () => {
  vi.mocked(lookupPlaceContact).mockResolvedValue({ website: 'https://suggested.example.com', phone: null });
  const fallback = vi.fn().mockResolvedValue(null);
  const result = await enrichOneLead({ ...lead, website: null }, { ...keys, googlePlaces: 'test' }, { siteFallback: fallback });
  expect(result?.proposed.website).toBe('https://suggested.example.com');
  expect(fallback).not.toHaveBeenCalled();
});
it('uses a team fallback after the worker and before paid sources, proposing only for review', async () => {
  const order: string[] = [];
  const result = await enrichOneLead(lead, { ...keys, hunter: 'test' }, {
    siteFallback: async () => { order.push('worker'); return null; },
    teamFallback: async () => { order.push('firecrawl'); return { people: [{ name: 'Jane Smith', role: 'Director' }], emails: ['jane@example.com'] }; },
  });
  expect(order).toEqual(['worker', 'firecrawl']);
  expect(result).toMatchObject({ proposed: { owner_name: 'Jane Smith', email: 'jane@example.com' }, source: { owner_name: 'firecrawl', email: 'firecrawl' } });
  expect(lookupHunterEmail).not.toHaveBeenCalled();
});
it('skips the team fallback when owner is present, or a website is only proposed', async () => {
  const teamFallback = vi.fn();
  await enrichOneLead({ ...lead, owner_name: 'Jane Smith' }, keys, { teamFallback });
  vi.mocked(lookupPlaceContact).mockResolvedValue({ website: 'https://proposed.example.com', phone: null });
  await enrichOneLead({ ...lead, website: null }, { ...keys, googlePlaces: 'test' }, { teamFallback });
  expect(teamFallback).not.toHaveBeenCalled();
});
it('continues existing sources when Firecrawl finds nothing', async () => {
  vi.mocked(lookupHunterEmail).mockResolvedValue('hunter@example.com');
  const result = await enrichOneLead(lead, { ...keys, hunter: 'test' }, { teamFallback: vi.fn().mockResolvedValue(null) });
  expect(result?.source.email).toBe('hunter');
});
it('uses a free registry owner before spending Firecrawl credits', async () => {
  vi.mocked(lookupCompaniesHouseOfficer).mockResolvedValue('Jane Smith');
  const teamFallback = vi.fn();
  const result = await enrichOneLead(lead, { ...keys, companiesHouse: 'fake' }, { teamFallback });
  expect(result?.source.owner_name).toBe('companies_house');
  expect(teamFallback).not.toHaveBeenCalled();
});
it('passes already read same-domain links without an extra page fetch, and rejects off-domain redirects', async () => {
  const html = '<a href="/team">Team</a>';
  vi.mocked(scrapeWebsiteContact).mockImplementation(async (_url, _max, onPage) => {
    onPage?.(html, 'https://example.com/');
    return { email: null, phone: null };
  });
  const teamFallback = vi.fn().mockResolvedValue(null);
  await enrichOneLead(lead, keys, { teamFallback });
  expect(teamFallback).toHaveBeenCalledWith('https://example.com', [html]);
  vi.mocked(scrapeWebsiteContact).mockImplementation(async (_url, _max, onPage) => {
    onPage?.(html, 'https://other.com/');
    return { email: null, phone: null };
  });
  teamFallback.mockClear();
  await enrichOneLead(lead, keys, { teamFallback });
  expect(teamFallback).not.toHaveBeenCalled();
});

it('prefers a decision maker over the first team member', async () => {
  const result = await enrichOneLead(lead, keys, { teamFallback: async () => ({ people: [
    { name: 'Alice Smith', role: 'Designer' }, { name: 'Jane Jones', role: 'Founder' },
  ], emails: [] }) });
  expect(result?.proposed.owner_name).toBe('Jane Jones');
});
it.each(['Owner', 'Director', 'Founder', 'Managing Director', 'CEO', 'Proprietor', 'Principal', 'Partner'])('offers a %s for review without using the new name in Hunter', async (role) => {
  vi.mocked(lookupHunterEmail).mockResolvedValue('info@example.com');
  const result = await enrichOneLead(lead, { ...keys, hunter: 'fake' }, { teamFallback: async () => ({ people: [{ name: 'Jane Smith', role }], emails: [] }) });
  expect(result?.proposed.owner_name).toBe('Jane Smith');
  expect(lookupHunterOwnerEmail).not.toHaveBeenCalled();
  expect(lookupHunterEmail).toHaveBeenCalledWith(lead.website, 'fake');
});
it('does not propose an owner from people whose roles do not match', async () => {
  expect(await enrichOneLead(lead, keys, { teamFallback: async () => ({ people: [{ name: 'Jane Smith', role: 'Designer' }], emails: [] }) })).toBeNull();
});
it('still uses a saved owner name for Hunter', async () => {
  vi.mocked(lookupHunterOwnerEmail).mockResolvedValue('jane@example.com');
  await enrichOneLead({ ...lead, owner_name: 'Jane Smith' }, { ...keys, hunter: 'fake' });
  expect(lookupHunterOwnerEmail).toHaveBeenCalledWith(lead.website, 'Jane Smith', 'fake');
});
it('returns earlier proposals when the Firecrawl checkpoint fails', async () => {
  vi.mocked(scrapeWebsiteContact).mockResolvedValue({ email: null, phone: '1234567890' });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  let checks = 0;
  const fallback = vi.fn();
  try {
    const result = await enrichOneLead(lead, { ...keys, hunter: 'fake' }, { teamFallback: fallback, checkpoint: async () => {
      if (++checks === 3) throw new Error('private-checkpoint');
    } });
    expect(result?.proposed).toEqual({ phone: '1234567890' });
    expect(fallback).not.toHaveBeenCalled();
    expect(lookupHunterEmail).not.toHaveBeenCalled();
    expect(log.mock.calls).toEqual([['lookup: Firecrawl checkpoint failed']]);
  } finally { log.mockRestore(); }
});
