import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../supabase/functions/_shared/websiteContact', () => ({ scrapeWebsiteContact: vi.fn() }));
vi.mock('../../supabase/functions/_shared/companiesHouse', () => ({ lookupCompaniesHouseOfficer: vi.fn() }));
vi.mock('../../supabase/functions/_shared/openCorporates', () => ({ lookupOpenCorporatesOfficer: vi.fn() }));
vi.mock('../../supabase/functions/_shared/apolloHunterLookup', () => ({ lookupApolloPhone: vi.fn(), lookupHunterEmail: vi.fn(), lookupHunterOwnerEmail: vi.fn() }));
vi.mock('../../supabase/functions/_shared/googlePlacesLookup', () => ({ lookupPlaceContact: vi.fn() }));
import { scrapeWebsiteContact } from '../../supabase/functions/_shared/websiteContact';
import { lookupHunterEmail } from '../../supabase/functions/_shared/apolloHunterLookup';
import { lookupPlaceContact } from '../../supabase/functions/_shared/googlePlacesLookup';
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
