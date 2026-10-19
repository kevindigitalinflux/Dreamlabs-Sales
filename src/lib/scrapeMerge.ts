import type { RawLead, ScrapeSource } from '../types';
import { isDirectoryDomain } from '../../supabase/functions/_shared/knownPerson';

export const SOURCE_NAMES: Record<ScrapeSource, string> = {
  google_places: 'Google Places', companies_house: 'Companies House', cro: 'Irish CRO', csv_upload: 'CSV upload',
};
export const SEARCH_SOURCES = ['google_places', 'companies_house', 'cro'] as const;
export type SearchSource = typeof SEARCH_SOURCES[number];

export function sourceAvailability(source: SearchSource, country: string | undefined, configured: boolean): string | null {
  if (source === 'companies_house' && country !== 'GB') return 'UK searches only';
  if (source === 'cro' && country !== 'IE') return 'Ireland searches only';
  return configured ? null : 'No key configured. Add one in Settings.';
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const normal = (value: unknown): string => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const name = (value: string): string => normal(value).replace(/\s+(limited|ltd|incorporated|inc|llc|plc)$/, '').trim();
const registry = (row: RawLead): boolean => row.source === 'companies_house' || row.source === 'cro';

function companyNumber(row: RawLead): string {
  const company = object(row.raw_data?.company);
  return text(company.company_number || (registry(row) ? row.source_id : null)).replace(/\s/g, '').toUpperCase();
}

function host(value: string | null): string {
  if (!value?.trim()) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return '';
    const domain = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    // Builder tenants have their own host; shared path-based pages are never host identity.
    const builderTenant = ['wixsite.com', 'squarespace.com'].some((d) => domain.endsWith(`.${d}`));
    if (isDirectoryDomain(domain) && !builderTenant) return '';
    const aggregators = ['booking.com', 'tripadvisor.com', 'tripadvisor.co.uk', 'opentable.com', 'opentable.co.uk',
      'fresha.com', 'treatwell.co.uk', 'treatwell.ie', 'booksy.com', 'resy.com', 'expedia.com', 'hotels.com',
      'airbnb.com', 'airbnb.co.uk', 'trivago.com', 'agoda.com', 'mindbodyonline.com', 'schedulicity.com', 'vagaro.com'];
    if (aggregators.some((d) => domain === d || domain.endsWith(`.${d}`))) return '';
    return domain;
  } catch (error) {
    // Invalid source values are not identity evidence. No provider request is made here.
    if (!(error instanceof TypeError)) console.error('Scrape website normalisation failed', error);
    return '';
  }
}

/** Normalised UK postcode or Irish Eircode embedded in a source address. */
export function extractAddressPostcode(address: string | null | undefined): string {
  const found = address?.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}|(?:[AC-FHKNPRTV-Y]\d{2}|D6W)\s*[0-9AC-FHKNPRTV-Y]{4})\b/i)?.[1] ?? '';
  return found.replace(/\s/g, '').toUpperCase();
}

function postcode(row: RawLead): string {
  const company = object(row.raw_data?.company);
  const address = object(company.address);
  const found = text(row.postcode || address.postal_code || company.eircode)
    || extractAddressPostcode(row.address);
  return normal(found).replace(/ /g, '').toUpperCase();
}

function same(a: RawLead, b: RawLead): boolean {
  const an = companyNumber(a), bn = companyNumber(b);
  // Registered companies with different numbers must never join through weaker evidence.
  if (an && bn) return an === bn && (a.source !== 'cro' || b.source !== 'companies_house') && (a.source !== 'companies_house' || b.source !== 'cro');
  const ap = postcode(a), bp = postcode(b);
  if (ap && bp && ap !== bp) return false;
  const ah = host(a.website), bh = host(b.website);
  if (ah && bh && ah === bh) return true;
  if (!name(a.business_name) || name(a.business_name) !== name(b.business_name)) return false;
  if (ap && bp) return ap === bp;
  const ac = normal(a.city), bc = normal(b.city);
  return !!ac && ac === bc;
}

export interface MergedRawLead extends RawLead {
  rawIds: string[];
  sources: ScrapeSource[];
  companyNumber: string | null;
  /** Original rows preserve every non-empty value, including conflicting source facts. */
  members: RawLead[];
}

const nonempty = (value: unknown): boolean => value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '');

export function mergeScrapeLeads(rows: RawLead[]): MergedRawLead[] {
  // Stable registry-first ordering keeps the FK on the officer-bearing row, regardless of arrival order.
  const sorted = [...rows].sort((a, b) => Number(registry(b)) - Number(registry(a)) || a.id.localeCompare(b.id));
  const groups: RawLead[][] = [];
  for (const row of sorted) {
    let target = [row];
    for (let i = 0; i < groups.length;) {
      const group = groups[i];
      const numbers = new Set([...target, ...group].map(companyNumber).filter(Boolean));
      const registries = new Set([...target, ...group].filter(registry).map((r) => r.source));
      const postcodes = new Set([...target, ...group].map(postcode).filter(Boolean));
      // A postcode-less row cannot bridge distinct locations through a host or name match.
      const sameCompany = numbers.size === 1 && [...target, ...group].every((r) => !!companyNumber(r));
      if (numbers.size <= 1 && registries.size <= 1 && (postcodes.size <= 1 || sameCompany)
        && target.some((a) => group.some((b) => same(a, b)))) {
        target.push(...group); groups.splice(i, 1); i = 0;
      } else i++;
    }
    groups.push(target);
  }
  return groups.map((group) => {
    const members = group.sort((a, b) => Number(registry(b)) - Number(registry(a)) || a.id.localeCompare(b.id));
    const anchor = members[0];
    const merged = { ...anchor } as MergedRawLead;
    const fields = ['business_name', 'owner_name', 'phone', 'email', 'website', 'address', 'city', 'postcode', 'google_rating', 'review_count', 'vertical'] as const;
    for (const field of fields) {
      const preferred = field === 'phone' || field === 'website'
        ? [...members].sort((a, b) => Number(b.source === 'google_places') - Number(a.source === 'google_places')) : members;
      const value = preferred.map((r) => r[field]).find(nonempty);
      if (value !== undefined) Object.assign(merged, { [field]: value });
    }
    merged.postcode ||= members.map(postcode).find(Boolean) || null;
    const officers = members.flatMap((r) => Array.isArray(r.raw_data?.officers) ? r.raw_data.officers : []);
    merged.raw_data = { ...anchor.raw_data, officers: [...new Map(officers.map((o) => [JSON.stringify(o), o])).values()] };
    merged.rawIds = members.map((r) => r.id);
    merged.sources = [...new Set(members.map((r) => r.source))];
    merged.companyNumber = members.map(companyNumber).find(Boolean) || null;
    merged.members = members;
    merged.status = members.some((r) => r.status === 'approved') ? 'approved'
      : members.every((r) => r.status === 'rejected') ? 'rejected'
      : members.some((r) => r.status === 'pending') ? 'pending'
      : members.some((r) => r.status === 'duplicate') ? 'duplicate' : 'pending';
    return merged;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
