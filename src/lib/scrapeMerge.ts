import type { RawLead, ScrapeSource } from '../types';

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
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch (error) {
    // Invalid source values are not identity evidence. No provider request is made here.
    if (!(error instanceof TypeError)) console.error('Scrape website normalisation failed', error);
    return '';
  }
}

function postcode(row: RawLead): string {
  const company = object(row.raw_data?.company);
  const address = object(company.address);
  const found = text(row.postcode || address.postal_code || company.eircode)
    || row.address?.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[1] || '';
  return normal(found).replace(/ /g, '');
}

function same(a: RawLead, b: RawLead): boolean {
  const an = companyNumber(a), bn = companyNumber(b);
  // Registered companies with different numbers must never join through weaker evidence.
  if (an && bn) return an === bn && (a.source !== 'cro' || b.source !== 'companies_house') && (a.source !== 'companies_house' || b.source !== 'cro');
  const ah = host(a.website), bh = host(b.website);
  if (ah && bh && ah === bh) return true;
  if (!name(a.business_name) || name(a.business_name) !== name(b.business_name)) return false;
  const ap = postcode(a), bp = postcode(b);
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
      if (numbers.size <= 1 && registries.size <= 1 && target.some((a) => group.some((b) => same(a, b)))) {
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
    merged.postcode ||= postcode(anchor) || null;
    const officers = members.flatMap((r) => Array.isArray(r.raw_data?.officers) ? r.raw_data.officers : []);
    merged.raw_data = { ...anchor.raw_data, officers: [...new Map(officers.map((o) => [JSON.stringify(o), o])).values()] };
    merged.rawIds = members.map((r) => r.id);
    merged.sources = [...new Set(members.map((r) => r.source))];
    merged.companyNumber = members.map(companyNumber).find(Boolean) || null;
    merged.members = members;
    merged.status = members.some((r) => r.status === 'approved') ? 'approved'
      : members.some((r) => r.status === 'rejected') ? 'rejected'
      : members.some((r) => r.status === 'duplicate') ? 'duplicate' : 'pending';
    return merged;
  }).sort((a, b) => a.id.localeCompare(b.id));
}
