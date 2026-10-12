import type { DeepFindLeadRow } from '../types';

/** Defaults and limits shown in the Deep find confirm step (the server enforces the same). */
export const DEEP_FIND_DEFAULT_CAPS = { hunter: 60, ai: 25 } as const;
export const DEEP_FIND_CAP_LIMITS = { hunter: 500, ai: 200 } as const;
export const DEEP_FIND_MAX_LEADS = 25;

/** Plain label for a lead's status. */
export const DEEP_FIND_STATUS_LABELS: Record<DeepFindLeadRow['status'], string> = {
  queued: 'Waiting', running: 'Searching', done: 'Done', failed: 'Did not work', skipped: 'Skipped',
};

/** One discovered domain as the engine stored it. */
export interface DeepFindDomain { domain: string; needs_check: boolean }
/** A person named by the web search or the website, not saved as a contact. */
export interface DeepFindNamed { name: string; role: string | null }

/** The engine's per-lead details, read defensively (the JSON is engine-written but typed as unknown). */
export interface DeepFindDetails {
  domains: DeepFindDomain[];
  namedByWeb: DeepFindNamed[];
  namedOnSite: DeepFindNamed[];
  /** People Hunter lists on a domain that could not be confirmed as the company's (never stored). */
  unverified: DeepFindNamed[];
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);

function named(list: unknown): DeepFindNamed[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).flatMap((p) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const name = text(o.name, 80);
    return name ? [{ name, role: text(o.role, 60) }] : [];
  });
}

/** Reads a deep_find_leads.domains value into typed lists; anything malformed is dropped. */
export function readDeepFindDetails(value: unknown): DeepFindDetails {
  const o = (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const domains = (Array.isArray(o.domains) ? o.domains : []).slice(0, 8).flatMap((d) => {
    const x = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
    const domain = text(x.domain, 253);
    return domain ? [{ domain, needs_check: x.needs_check === true }] : [];
  });
  return { domains, namedByWeb: named(o.named_by_web), namedOnSite: named(o.named_on_site), unverified: named(o.unverified_people) };
}

/** "Company domains: loveliving.uk (found automatically)" for the lead card, or null when there are none. */
export function companyDomainsLine(domains: string[] | null | undefined): string | null {
  const list = (domains ?? []).filter((d) => typeof d === 'string' && d.trim() !== '').slice(0, 8);
  if (list.length === 0) return null;
  return `Company domains: ${list.join(', ')} (found automatically, check before emailing)`;
}

/** Counts per status and whether anything is still waiting or running. */
export function deepFindProgress(rows: Pick<DeepFindLeadRow, 'status' | 'people_found'>[]): { done: number; total: number; people: number; working: boolean } {
  const finished = rows.filter((r) => r.status === 'done' || r.status === 'failed' || r.status === 'skipped').length;
  return {
    done: finished, total: rows.length,
    people: rows.reduce((n, r) => n + (Number.isFinite(r.people_found) ? r.people_found : 0), 0),
    working: rows.some((r) => r.status === 'queued' || r.status === 'running'),
  };
}

/** A cap field value as a whole number inside 0..max, or null when it is not one. */
export function parseCap(value: string, max: number): number | null {
  if (!/^\d{1,4}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n <= max ? n : null;
}
