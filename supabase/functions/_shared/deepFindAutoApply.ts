// Shared automatic-change rules. No providers, database client or runtime dependencies.
import { DOMAIN_CHECKS, savedDomains } from './domainChecks.ts';
import { domainFromWebsite, isDirectoryDomain } from './knownPerson.ts';

export type AutoValue = string | null | string[];
export interface AutoApplied { table: 'leads' | 'decision_maker_candidates'; id: string; field: string; before: AutoValue; after: AutoValue; archivedWebsite?: string }
/** PostgREST text[] equality requires a quoted array literal. */
export const arrayEquality = (values: string[]): string => `{${values.map((v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`;
const FIELDS: Record<AutoApplied['table'], readonly string[]> = {
  leads: ['website', 'additional_websites', 'email', 'owner_name', 'phone', 'company_number'],
  decision_maker_candidates: ['linkedin_url', 'email', 'phone', 'title'],
};
const scalar = (v: unknown): v is string | null => v === null || typeof v === 'string';
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

/** Only explicitly supported fields can become session writes, even in malformed historical JSON. */
export function readAutoApplied(value: unknown): AutoApplied[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).filter((v): v is AutoApplied => {
    if (!v || typeof v !== 'object' || !Object.hasOwn(FIELDS, v.table) || typeof v.id !== 'string' || !v.id) return false;
    if (!FIELDS[v.table as AutoApplied['table']].includes(v.field)) return false;
    if (v.archivedWebsite !== undefined && (v.table !== 'leads' || v.field !== 'website' || typeof v.archivedWebsite !== 'string' || v.archivedWebsite !== v.before)) return false;
    return v.field === 'additional_websites' ? (v.before === null || strings(v.before)) && strings(v.after)
      : scalar(v.before) && typeof v.after === 'string' && !!v.after.trim();
  });
}

/** Own-site evidence is mandatory. A skipped site check never means an unreachable website. */
export function planWebsiteAutoUpdate(
  lead: { id: string; website?: unknown; additional_websites?: unknown; blocked_domains?: unknown },
  domains: { domain: string; needs_check: boolean; sources: readonly string[] }[],
  site: { checked: boolean; reachable: boolean; suspect: boolean },
): { website: string; additional_websites?: string[] } | null {
  const before = typeof lead.website === 'string' ? lead.website : null;
  const current = domainFromWebsite(before);
  const blocked = savedDomains(lead.blocked_domains);
  if (current && (isDirectoryDomain(current) || blocked.includes(current))) return null;
  // A confirmed good saved domain is never replaced, even if another candidate ranks first.
  if (current && domains.some((d) => d.domain === current && !d.needs_check && d.sources.includes('site_confirms'))) return null;
  if (before?.trim() && !(site.checked && !site.reachable) && !site.suspect) return null;
  const chosen = domains.find((d) => !d.needs_check && d.sources.includes('site_confirms')
    && DOMAIN_CHECKS.clean(d.domain) === d.domain && DOMAIN_CHECKS.usable(d.domain) && !blocked.includes(d.domain) && d.domain !== current);
  if (!chosen) return null;
  const patch: { website: string; additional_websites?: string[] } = { website: `https://${chosen.domain}` };
  if (before?.trim()) {
    const old = strings(lead.additional_websites) ? lead.additional_websites : [];
    const seen = new Set<string>();
    patch.additional_websites = [...old, before].filter((v) => {
      const key = v.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
  }
  return patch;
}

const words = (v: string) => v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (line: string, value: string) => !!words(value) && ` ${words(line)} `.includes(` ${words(value)} `);

/** Untrusted evidence must bind the exact profile, person and company on one line. Never fetches LinkedIn. */
export function linkedinMatch(url: unknown, evidence: unknown, name: string, companies: string[], domains: string[]): { url: string; high: boolean; evidence: string } | null {
  if (typeof url !== 'string' || !/^https:\/\/www\.linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/.test(url.trim())) return null;
  const lines = typeof evidence === 'string' ? evidence.slice(0, 12_000).split(/[\r\n]+/).filter((l) => !l.trim().startsWith('{') && !l.trim().startsWith('```')) : [];
  const named = lines.filter((l) => contains(l, name));
  const slug = url.trim().replace(/\/$/, '').split('/').pop()!;
  const profileOnLine = (line: string) => line.split(/[^a-zA-Z0-9_-]+/).includes(slug);
  const strong = named.find((l) => profileOnLine(l) && [...companies, ...domains].some((c) => contains(l, c)));
  const line = strong ?? named[0] ?? lines[0] ?? 'No supporting evidence was returned. Check this profile before adding.';
  return { url: url.trim().replace(/\/$/, ''), high: !!strong, evidence: line.slice(0, 500) };
}
