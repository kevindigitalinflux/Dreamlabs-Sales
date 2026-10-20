// supabase/functions/_shared/registrySearch.ts
// Pure rules for finding a lead's registered company on Companies House by NAME, with or without a location. Only
// imports the import-free nameVariants.ts: tested from src/lib. The search reply is untrusted data: every field is type-checked.
// Rule (Review Focus 1 and 2): a common name, a dissolved company or a name match in a different town never produces
// an automatic pick. Then the top candidates are offered to the user ("Use this company").

import { sameCompanyName } from './nameVariants.ts';

/** One Companies House search result, cleaned, with its score. */
export interface CompanyCandidate {
  company_number: string;
  name: string;
  address: string | null;
  status: string | null;
  postcode: string | null;
  locality: string | null;
  created: string | null;
  score: number;
  /** Why it is offered, a fixed sentence ("Name matches", "Max Whatley is a director there"). */
  why?: string;
}

/** What is known about where the lead is. Any field may be missing. */
export interface LeadLocation { postcode: string | null; city: string | null; address: string | null }

/** How the registered company was settled. */
export type CompanyPick =
  | { chosen: CompanyCandidate; candidates: CompanyCandidate[]; reason: 'auto_location' | 'auto_unique' }
  | { chosen: null; candidates: CompanyCandidate[]; reason: 'ambiguous' | 'none' };

/** A Companies House number: 8 digits, or two letters and 6 digits (SC, NI, OC and so on). Uppercased. */
export function cleanCompanyNumber(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toUpperCase();
  return /^(?:[0-9]{8}|[A-Z]{2}[0-9]{6})$/.test(v) ? v : null;
}

const NAME_NOISE = new Set(['ltd', 'limited', 'llp', 'plc', 'the', 'and', 'company', 'co', 'cic', 'lp']);

/** Name words for comparing company names: lowercase, accents removed, "&" read as "and", legal forms dropped. */
export function companyNameTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const words = value.slice(0, 200).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter((w) => w && !NAME_NOISE.has(w));
  return [...new Set(words)];
}

const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null);

/** UK postcode key: letters and digits only, uppercase. */
function postcodeKey(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

/** The outward part of a UK postcode (E8 from E8 3PL), or ''. */
function outwardCode(value: unknown): string {
  const k = postcodeKey(value);
  return k.length >= 5 ? k.slice(0, k.length - 3) : '';
}

/** Cleans the Companies House `items[]` array. Anything malformed is dropped; at most 20 results. */
export function parseCompanySearchItems(items: unknown): Omit<CompanyCandidate, 'score'>[] {
  if (!Array.isArray(items)) return [];
  const out: Omit<CompanyCandidate, 'score'>[] = [];
  for (const raw of items.slice(0, 20)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const i = raw as Record<string, unknown>;
    const number = cleanCompanyNumber(i.company_number);
    const name = text(i.title, 160);
    if (!number || !name || out.some((c) => c.company_number === number)) continue;
    const addr = (typeof i.address === 'object' && i.address !== null ? i.address : {}) as Record<string, unknown>;
    out.push({
      company_number: number, name,
      address: text(i.address_snippet, 200),
      status: text(i.company_status, 40)?.toLowerCase() ?? null,
      postcode: text(addr.postal_code, 12),
      locality: text(addr.locality, 60),
      created: text(i.date_of_creation, 10),
    });
  }
  return out;
}

/** True when the candidate's registered address agrees with what is known about the lead's location. */
export function locationAgrees(c: Pick<CompanyCandidate, 'postcode' | 'locality' | 'address'>, loc: LeadLocation): boolean {
  const pc = postcodeKey(loc.postcode);
  if (pc && postcodeKey(c.postcode) === pc) return true;
  if (pc && outwardCode(loc.postcode) && outwardCode(c.postcode) === outwardCode(loc.postcode)) return true;
  const where = `${c.locality ?? ''} ${c.address ?? ''}`.toLowerCase();
  for (const place of [loc.city, loc.address]) {
    for (const w of companyNameTokens(place)) {
      if (w.length >= 4 && new RegExp(`\\b${w}\\b`).test(where)) return true;
    }
  }
  return false;
}

/** Strong E2 needs a full postcode or a specific address, never city alone. */
export function strongLocationAgrees(c: Pick<CompanyCandidate, 'postcode' | 'locality' | 'address'>, loc: LeadLocation): boolean {
  const pc = postcodeKey(loc.postcode);
  if (pc && postcodeKey(c.postcode) === pc) return true;
  if (pc && postcodeKey(c.postcode) && postcodeKey(c.postcode) !== pc) return false;
  const addressWords = ['rd', 'st', 'suite', 'floor', 'office', 'unit', 'road', 'street', 'court', 'house', 'building'];
  const stopWords = [...addressWords, ...addressWords.map(w => w + 's'), ...companyNameTokens(loc.city)];
  const words = (v: string | null) => companyNameTokens(v).filter(w => !stopWords.includes(w));
  const street = words(loc.address);
  const target = words(c.address);
  return street.length >= 2 && street.filter(w => target.includes(w)).length >= 2;
}

/** True when the lead has any location information at all. */
export function hasLocation(loc: LeadLocation): boolean {
  return !!(text(loc.postcode, 12) || text(loc.city, 60) || text(loc.address, 200));
}

/**
 * Scores every candidate (highest first): name overlap up to 50, all of the lead's name words present 20, active 20,
 * location agrees 30. Inactive companies stay in the list (shown with their status) but are never picked automatically.
 */
export function scoreCompanyCandidates(items: unknown, leadName: string, loc: LeadLocation): CompanyCandidate[] {
  const lead = companyNameTokens(leadName);
  return parseCompanySearchItems(items).map((c) => {
    const tokens = companyNameTokens(c.name);
    const shared = lead.filter((t) => tokens.includes(t)).length;
    const union = new Set([...lead, ...tokens]).size || 1;
    // Spacing and legal forms do not make a different name: LOVELIVING LIMITED is a full match for Love Living.
    const all = (lead.length > 0 && shared === lead.length) || sameCompanyName(c.name, leadName);
    const score = Math.round((shared / union) * 50) + (all ? 20 : 0) + (c.status === 'active' ? 20 : 0) + (locationAgrees(c, loc) ? 30 : 0);
    return { ...c, score };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * Picks the registered company only when it is clearly this lead; otherwise returns the top 3 to choose from.
 * Auto-pick rules (active companies whose name contains every one of the lead's name words):
 * - exactly one of them has a registered address that agrees with the lead's location (or, if several agree, exactly
 *   one of those has the lead's exact name); or
 * - the lead has NO location at all, and exactly one active company carries all the name words and it has the exact
 *   same name. A second active company that also carries all the words ("Love Living" and "Love Living Homes")
 *   means a choice, never a guess. A name match whose address disagrees with a known location is never picked.
 */
export function pickCompany(scored: CompanyCandidate[], leadName: string, loc: LeadLocation): CompanyPick {
  const lead = companyNameTokens(leadName);
  const candidates = scored.slice(0, 5);
  if (lead.length === 0 || scored.length === 0) return { chosen: null, candidates, reason: 'none' };
  const tokensOf = (c: CompanyCandidate) => companyNameTokens(c.name);
  const isExact = (c: CompanyCandidate) => {
    const t = tokensOf(c);
    return (t.length === lead.length && lead.every((w) => t.includes(w))) || sameCompanyName(c.name, leadName);
  };
  const matches = scored.filter((c) => c.status === 'active' && (lead.every((w) => tokensOf(c).includes(w)) || sameCompanyName(c.name, leadName)));
  if (matches.length === 0) return { chosen: null, candidates, reason: candidates.length ? 'ambiguous' : 'none' };
  if (hasLocation(loc)) {
    const located = matches.filter((c) => locationAgrees(c, loc));
    if (located.length === 1) return { chosen: located[0]!, candidates, reason: 'auto_location' };
    const exactLocated = located.filter(isExact);
    if (located.length > 1 && exactLocated.length === 1) return { chosen: exactLocated[0]!, candidates, reason: 'auto_location' };
    return { chosen: null, candidates, reason: 'ambiguous' };
  }
  if (matches.length === 1 && isExact(matches[0]!)) return { chosen: matches[0]!, candidates, reason: 'auto_unique' };
  return { chosen: null, candidates, reason: 'ambiguous' };
}
