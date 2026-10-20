import type { DeepFindLeadRow } from '../types';
import { isReviewPhone, registrySkipReason, visibleSuggestions } from '../../supabase/functions/_shared/deepFindSuggestions';
import type { ReviewLead, ReviewContact } from '../../supabase/functions/_shared/deepFindSuggestions';
import { readAutoApplied, type AutoApplied } from '../../supabase/functions/_shared/deepFindAutoApply';

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
  autoApplied: AutoApplied[];
  domains: DeepFindDomain[];
  namedByWeb: DeepFindNamed[];
  namedOnSite: DeepFindNamed[];
  /** People Hunter lists on a domain that could not be confirmed as the company's (never stored). */
  unverified: DeepFindNamed[];
  /** Companies House companies to choose from when the search was not clear (at most 5, each with why). */
  companyCandidates: DeepFindCompanyCandidate[];
  /** The company number the run used, when one was settled. */
  companyNumber: string | null;
  /** Plain-English step lines. */
  steps: string[];
  /** People the run looked up, with their role and whether an email was found. */
  people: DeepFindPerson[];
  /** True when the lead's website looked like another company's, with the plain reasons. */
  websiteSuspect: boolean;
  websiteReasons: string[];
  /** Addresses found or built but not saved (site emails for non-contacts, email-format guesses): the user checks them. */
  suggestions: DeepFindSuggestion[];
}

/** One address offered to check, with where it came from (a fixed label). */
export interface DeepFindSuggestion { guess_rank?: 'most_likely' | 'other'; name: string; value: string; label: string; field?: string }

/** One Companies House company offered with "Use this company". */
export interface DeepFindCompanyCandidate { company_number: string; name: string; address: string | null; status: string | null; why?: string }
/** A person the run looked up. */
export interface DeepFindPerson { name: string; role: string | null; source: string; email_found: boolean }

const COMPANY_NUMBER_RE = /^(?:[0-9]{8}|[A-Z]{2}[0-9]{6})$/;

function companyCandidates(list: unknown): DeepFindCompanyCandidate[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).flatMap((c) => {
    const o = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    const number = typeof o.company_number === 'string' && COMPANY_NUMBER_RE.test(o.company_number) ? o.company_number : null;
    const name = text(o.name, 160);
    const why = text(o.why, 600);
    return number && name ? [{ company_number: number, name, address: text(o.address, 200), status: text(o.status, 40), ...(why ? { why } : {}) }] : [];
  });
}

function peopleList(list: unknown): DeepFindPerson[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).flatMap((p) => {
    const o = (typeof p === 'object' && p !== null ? p : {}) as Record<string, unknown>;
    const name = text(o.name, 80);
    return name ? [{ name, role: text(o.role, 60), source: text(o.source, 20) ?? 'contact', email_found: o.email_found === true }] : [];
  });
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
  const number = typeof o.company_number === 'string' && COMPANY_NUMBER_RE.test(o.company_number) ? o.company_number : null;
  const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, 40).flatMap((s) => { const t = text(s, 300); return t ? [t] : []; });
  const suggestions = (Array.isArray(o.suggestions) ? o.suggestions : []).slice(0, 25).flatMap((s) => {
    const x = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const name = text(x.name, 80);
    const value = text(x.value, 200);
    const label = text(x.label, 500);
    if (x.field === 'phone' && !isReviewPhone(value)) return [];
    return name && value && label && ['email', 'linkedin_url', 'phone', 'owner_name', 'website', 'title'].includes(String(x.field)) ? [{ name, value, label, ...((x.guess_rank === 'most_likely' || x.guess_rank === 'other') ? { guess_rank: x.guess_rank as 'most_likely' | 'other' } : {}), ...(x.field !== 'email' ? { field: String(x.field) } : {}) }] : [];
  });
  return {
    autoApplied: readAutoApplied(o.auto_applied),
    domains, namedByWeb: named(o.named_by_web), namedOnSite: named(o.named_on_site), unverified: named(o.unverified_people),
    companyCandidates: number ? [] : companyCandidates(o.company_candidates), companyNumber: number, steps, people: peopleList(o.people),
    websiteSuspect: o.website_suspect === true,
    websiteReasons: (Array.isArray(o.website_reasons) ? o.website_reasons : []).slice(0, 3).flatMap((r) => { const t = text(r, 200); return t ? [t] : []; }),
    suggestions,
  };
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

/** A recent deep_find_leads row as the activity views read it. */
export interface DeepFindActivityRow {
  run_id: string;
  lead_id: string;
  status: DeepFindLeadRow['status'];
  people_found: number;
  domains: unknown;
  updated_at: string;
  lead: (ReviewLead & { company_number?: string | null; contacts?: ReviewContact[] }) | null;
}

/**
 * True when a finished lead needs the user: a Companies House choice that is still open (the lead has no company
 * number yet), or people to check (named by the web, the website, or on an unconfirmed domain).
 */
export function needsAttention(row: Pick<DeepFindActivityRow, 'status' | 'domains' | 'lead'>): boolean {
  if (row.status !== 'done') return false;
  const d = readDeepFindDetails(row.domains);
  const openChoice = d.companyCandidates.length > 0 && !row.lead?.company_number && !registrySkipReason(row.lead ?? {});
  return openChoice || visibleSuggestions([...d.suggestions, ...d.unverified, ...d.namedByWeb, ...d.namedOnSite], row.lead ?? {}, row.lead?.contacts ?? []).length > 0;
}

/** Per-run totals for the runs list: leads finished, leads in total, people added, leads needing the user. */
export interface RunTotals { done: number; total: number; people: number; attention: number }

/** Totals per run id from the activity rows (only rows the viewer can see are counted). */
export function runTotals(rows: DeepFindActivityRow[]): Record<string, RunTotals> {
  const out: Record<string, RunTotals> = {};
  for (const r of rows) {
    const t = out[r.run_id] ?? (out[r.run_id] = { done: 0, total: 0, people: 0, attention: 0 });
    t.total++;
    if (r.status === 'done' || r.status === 'failed' || r.status === 'skipped') t.done++;
    t.people += Number.isFinite(r.people_found) ? r.people_found : 0;
    if (needsAttention(r)) t.attention++;
  }
  return out;
}

/** Lead ids Deep find is queued for or working on right now. */
export function activeLeadIds(rows: Pick<DeepFindActivityRow, 'lead_id' | 'status'>[]): Set<string> {
  return new Set(rows.filter((r) => r.status === 'queued' || r.status === 'running').map((r) => r.lead_id));
}
