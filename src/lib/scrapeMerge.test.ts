import { describe, expect, it } from 'vitest';
import type { RawLead } from '../types';
import { mergeScrapeLeads, sourceAvailability } from './scrapeMerge';
import { readScrapeGroup, registryContactKey } from '../../supabase/functions/_shared/scrapeGroup';

export function raw(id: string, patch: Partial<RawLead> = {}): RawLead {
  return { id, scrape_job_id: 'job', business_name: 'Acme Ltd', owner_name: null,
    phone: null, email: null, website: null, address: null, city: 'London', postcode: null,
    google_rating: null, review_count: null, vertical: null, source: 'google_places',
    source_id: null, raw_data: null, status: 'pending', duplicate_of: null,
    approved_by: null, approved_at: null, created_at: '2026-10-19', ...patch };
}

describe('merged scrape review', () => {
  it('merges names with legal suffixes, punctuation and accents; anchors the registry FK and keeps Places contact fields', () => {
    const places = raw('p', { business_name: 'Ácme', website: 'acme.com', phone: '123', email: 'hi@acme.com' });
    const registry = raw('r', { source: 'companies_house', source_id: '12345678', website: 'old.com',
      raw_data: { company: { company_number: '12345678' }, officers: [{ first_name: 'Ann', last_name: 'Smith' }] } });
    const [merged] = mergeScrapeLeads([places, registry]);
    expect(merged.id).toBe('r');
    expect(merged.website).toBe('acme.com');
    expect(merged.phone).toBe('123');
    expect(merged.email).toBe('hi@acme.com');
    expect(merged.companyNumber).toBe('12345678');
    expect(merged.sources).toEqual(['companies_house', 'google_places']);
    expect(merged.rawIds).toEqual(['r', 'p']);
    expect(merged.raw_data?.officers).toEqual(registry.raw_data?.officers);
    expect(merged.members).toContain(places);
    expect(mergeScrapeLeads([registry, places])).toEqual([merged]);
  });
  it('matches company numbers before domains or names and preserves non-empty fields including zero', () => {
    const result = mergeScrapeLeads([
      raw('a', { source: 'companies_house', source_id: 'SC123456', city: null, review_count: 0 }),
      raw('b', { source: 'companies_house', source_id: ' sc123456 ', business_name: 'Different', phone: '9', city: 'York' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ phone: '9', city: 'York', review_count: 0 });
  });
  it('matches normalised website hosts, ignores paths, scheme and www, but not subdomains', () => {
    expect(mergeScrapeLeads([raw('a', { website: 'HTTPS://WWW.ACME.COM./about', city: null }),
      raw('b', { website: 'acme.com/contact', business_name: 'Other', city: null })])).toHaveLength(1);
    expect(mergeScrapeLeads([raw('a', { website: 'shop.acme.com' }),
      raw('b', { website: 'acme.com', business_name: 'Other' })])).toHaveLength(2);
  });
  it('never matches junk URLs or names without a location', () => {
    expect(mergeScrapeLeads([raw('a', { city: null, website: 'javascript:bad' }), raw('b', { city: null, website: 'javascript:bad' })])).toHaveLength(2);
  });
  it('uses normalised postcode before city and does not merge conflicting registered companies through a bridge', () => {
    expect(mergeScrapeLeads([raw('a', { postcode: 'SW1A 1AA', city: 'A' }), raw('b', { postcode: 'sw1a1aa', city: 'B' })])).toHaveLength(1);
    expect(mergeScrapeLeads([raw('a', { postcode: 'SW1A 1AA' }), raw('b', { postcode: 'N1 1AA' })])).toHaveLength(2);
    expect(mergeScrapeLeads([raw('a', { source: 'companies_house', source_id: '12345678' }),
      raw('p'), raw('b', { source: 'companies_house', source_id: '87654321' })])).toHaveLength(2);
  });
  it('extracts registry and Places postcodes and merges a domain bridge across more than two rows', () => {
    expect(mergeScrapeLeads([raw('a', { city: null, address: '1 Street, London SW1A 1AA' }),
      raw('b', { city: null, raw_data: { company: { address: { postal_code: 'SW1A1AA' } } } })])).toHaveLength(1);
    expect(mergeScrapeLeads([raw('a', { business_name: 'A', website: 'acme.com' }), raw('b', { business_name: 'B' }),
      raw('c', { business_name: 'B', website: 'acme.com' })])).toHaveLength(1);
  });
  it('retains all source values and officers; an approved member keeps late duplicates out of pending review', () => {
    const result = mergeScrapeLeads([raw('a', { status: 'approved', raw_data: { officers: [{ first_name: 'A' }] } }),
      raw('b', { status: 'duplicate', phone: '456', raw_data: { officers: [{ first_name: 'B' }] } })]);
    expect(result[0].status).toBe('approved');
    expect(result[0].members).toHaveLength(2);
    expect(result[0].raw_data?.officers).toHaveLength(2);
  });
});

describe('source availability and durable group metadata', () => {
  it('requires keys and country, including IE for CRO', () => {
    expect(sourceAvailability('companies_house', 'GB', true)).toBeNull();
    expect(sourceAvailability('companies_house', 'IE', true)).toMatch(/UK/);
    expect(sourceAvailability('cro', 'GB', true)).toMatch(/Ireland/);
    expect(sourceAvailability('cro', 'IE', false)).toMatch(/Settings/);
    expect(sourceAvailability('cro', 'IE', true)).toBeNull();
    expect(sourceAvailability('google_places', 'US', false)).toMatch(/Settings/);
  });
  it('validates group markers and leaves legacy and Autopilot contact lookups unchanged', () => {
    const params = { scrape_group: { id: '12345678-1234-4234-8234-123456789abc', sources: ['google_places', 'companies_house'] } };
    expect(readScrapeGroup(params)?.sources).toHaveLength(2);
    expect(readScrapeGroup({ scrape_group: { id: 'bad', sources: ['cro'] } })).toBeNull();
    expect(registryContactKey(params, 'key')).toBeNull();
    expect(registryContactKey({}, 'key')).toBe('key');
    expect(registryContactKey(null, null)).toBeNull();
  });
});
