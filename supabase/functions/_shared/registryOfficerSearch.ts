// supabase/functions/_shared/registryOfficerSearch.ts
// Finds a lead's company through the PEOPLE we know work there: Companies House officer search by name, then each
// matching officer's appointments, keeping companies whose name matches the lead's name variants. This is how
// "Max Whatley's company" is found when the company-name search misses. Imports only import-free modules (tested
// from src/lib). Response shapes are UNVERIFIED beyond the public API docs: every field is optional and type-checked.
import { coreWords, sameCompanyName } from './nameVariants.ts';
import { cleanCompanyNumber } from './registrySearch.ts';

/** A person to search for. */
export interface OfficerQuery { first: string; last: string }

/** A company found through an officer, with the fixed reason shown to the user. */
export interface OfficerCompany { company_number: string; name: string; status: string | null; why: string }

const APPOINTMENTS_PATH = /^\/officers\/[A-Za-z0-9_-]{1,80}\/appointments$/;

const key = (v: unknown): string[] => (typeof v === 'string'
  ? v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z]+/).filter(Boolean)
  : []);

/**
 * From a `/search/officers` answer (`items[]` with `title` "Max WHATLEY" or "WHATLEY, Max", and `links.self`
 * "/officers/<id>/appointments"), the appointment paths of officers whose name has the person's surname and first
 * name (or its initial as the first given name). At most 3; paths are re-validated so nothing else is ever fetched.
 */
export function officerAppointmentPaths(json: unknown, person: OfficerQuery): string[] {
  const items = typeof json === 'object' && json !== null ? (json as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  const first = key(person.first)[0];
  const last = key(person.last).join(' ');
  if (!first || !last) return [];
  const out: string[] = [];
  for (const raw of items.slice(0, 20)) {
    if (typeof raw !== 'object' || raw === null || out.length >= 3) continue;
    const r = raw as { title?: unknown; links?: { self?: unknown } };
    const words = key(r.title);
    const lastWords = last.split(' ');
    const hasLast = words.some((_, i) => lastWords.every((w, j) => words[i + j] === w));
    const given = words.filter((w) => !lastWords.includes(w));
    const firstOk = first.length > 1 && given[0] === first;
    const path = typeof r.links?.self === 'string' ? r.links.self : '';
    if (hasLast && firstOk && APPOINTMENTS_PATH.test(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** True when a registered company name is the lead's company by its name or one of its variants. */
export function companyNameMatches(companyName: string, leadNames: string[]): boolean {
  for (const n of leadNames) {
    if (sameCompanyName(companyName, n)) return true;
    const lead = coreWords(n).filter((w) => w !== 'and');
    const company = coreWords(companyName).filter((w) => w !== 'and');
    if (lead.length >= 2 && lead.every((w) => company.includes(w))) return true;
  }
  return false;
}

/**
 * From one officer's appointments (`items[]` with `appointed_to.{company_number,company_name,company_status}`,
 * `officer_role`, `resigned_on`), the companies whose name matches the lead (companyNameMatches). Current
 * appointments first. `who` is the person's name for the fixed reason ("Max Whatley is a director").
 */
export function appointmentCompanies(json: unknown, leadNames: string[], who: OfficerQuery): OfficerCompany[] {
  const items = typeof json === 'object' && json !== null ? (json as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  const name = `${who.first} ${who.last}`.replace(/[^\p{L} '-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const out: (OfficerCompany & { current: boolean })[] = [];
  for (const raw of items.slice(0, 50)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as { appointed_to?: Record<string, unknown>; officer_role?: unknown; resigned_on?: unknown };
    const a = r.appointed_to ?? {};
    const number = cleanCompanyNumber(a.company_number);
    const company = typeof a.company_name === 'string' ? a.company_name.slice(0, 160) : '';
    if (!number || !company || !companyNameMatches(company, leadNames) || out.some((c) => c.company_number === number)) continue;
    const role = typeof r.officer_role === 'string' ? r.officer_role.replace(/[^a-z-]/gi, '').replace(/-/g, ' ').slice(0, 30) : 'officer';
    const current = typeof r.resigned_on !== 'string';
    out.push({
      company_number: number, name: company, status: typeof a.company_status === 'string' ? a.company_status.slice(0, 40) : null,
      why: current ? `${name} is a ${role || 'officer'} there` : `${name} was a ${role || 'officer'} there`, current,
    });
  }
  return out.sort((x, y) => Number(y.current) - Number(x.current)).slice(0, 5).map(({ current: _c, ...c }) => c);
}
