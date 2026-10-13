// supabase/functions/_shared/domainDiscovery.ts
// Pure helpers for discovering the other domains a company uses (for example a lead whose website is
// lovelivingmanagement.com while its people use loveliving.uk). No imports on purpose: tested from src/lib.
// Provider, page and model text is untrusted data: every domain is cleaned and checked by caller-supplied
// predicates (the existing hostname, SSRF and directory rules) and must also fit the company's brand words.

/** Where a domain came from, strongest first (see SOURCE_RANK). */
export type DomainSource =
  | 'typed' | 'website' | 'website_suspect' | 'saved' | 'lead_email' | 'contact_email' | 'person_confirmed'
  | 'hunter_name' | 'hunter_name_weak' | 'website_email' | 'website_link' | 'web';

/** One sighting of a domain. */
export interface DomainCandidate { domain: string; source: DomainSource }

/**
 * A ranked, de-duplicated domain. `needs_check` is true when the domain is NOT corroborated (see isCorroborated):
 * it may be searched, but people found on it are only suggestions, and it is never saved or shown as fact.
 */
export interface DiscoveredDomain { domain: string; sources: DomainSource[]; needs_check: boolean }

/** Sources that on their own make a domain the company's: known to the user or the lead, or a strong Hunter name match. */
const STRONG_SOURCES: DomainSource[] = ['typed', 'website', 'saved', 'lead_email', 'contact_email', 'person_confirmed', 'hunter_name'];
/** Independent weak signals: two different ones together corroborate a domain. */
const WEAK_SOURCES: DomainSource[] = ['website_suspect', 'hunter_name_weak', 'website_email', 'website_link', 'web'];

/**
 * True when a domain's sightings make it the company's own: one strong source (a typed domain, the lead's website, a
 * saved domain, the lead's or a contact's email domain, a known person found on it, a Hunter name match against the
 * registered name), or at least two DIFFERENT weak signals (a suspect website, a weak Hunter match, an email or link
 * on the website, the web search).
 */
export function isCorroborated(sources: DomainSource[]): boolean {
  if (sources.some((s) => STRONG_SOURCES.includes(s))) return true;
  return new Set(sources.filter((s) => WEAK_SOURCES.includes(s))).size >= 2;
}

/** A person the web search named, used only to rank people other sources found (never saved on its own). */
export interface WebPerson { name: string; role: string | null }

/** The caller's hostname rules: `clean` normalises (or refuses) a value, `usable` refuses free-mail, directory and internal hosts. */
export interface DomainChecks { clean: (value: unknown) => string | null; usable: (domain: string) => boolean }

/** At most this many company domains are searched or kept. */
export const MAX_DISCOVERED_DOMAINS = 4;

const SOURCE_RANK: Record<DomainSource, number> = {
  typed: 0, website: 1, saved: 2, lead_email: 3, contact_email: 4, person_confirmed: 5, hunter_name: 6, website_suspect: 7,
  hunter_name_weak: 8, website_email: 9, website_link: 10, web: 11,
};

/**
 * Industry and trade words. They may be part of a company's name (and of its domain), but they never identify WHICH
 * company it is: "Sparkle Cleaning" is identified by "sparkle", not "cleaning". Strict matches require the
 * distinctive words (brand words minus these).
 */
export const INDUSTRY_WORDS = new Set([
  'cleaning', 'cleaners', 'cleaner', 'clean', 'property', 'properties', 'homes', 'home', 'housing', 'lettings',
  'letting', 'lets', 'estates', 'estate', 'agents', 'agent', 'agency', 'rentals', 'rental', 'design', 'designs',
  'web', 'digital', 'media', 'marketing', 'consulting', 'consultancy', 'consultants', 'builders', 'building', 'construction',
  'plumbing', 'plumbers', 'electrical', 'electricians', 'roofing', 'care', 'health', 'healthcare', 'dental', 'clinic',
  'legal', 'law', 'solicitors', 'accountants', 'accounting', 'finance', 'financial', 'insurance', 'travel', 'cars',
  'motors', 'garage', 'salon', 'beauty', 'hair', 'cafe', 'restaurant', 'studio', 'studios', 'facilities', 'maintenance',
  'office', 'offices', 'commercial', 'residential', 'domestic', 'logistics', 'transport', 'recruitment', 'staffing',
  'events', 'catering', 'training', 'education', 'school', 'nursery', 'fitness', 'gym', 'tech', 'technology', 'systems',
  'software', 'it', 'network', 'networks', 'print', 'printing', 'supplies', 'supply', 'hire', 'repairs', 'repair',
]);

/**
 * Words that say nothing about which company it is. A name made only of these has no brand words, and no domain is
 * ever matched to it. Ordinary nouns that are often the brand itself (living, homes, cleaning) are deliberately kept.
 */
export const GENERIC_COMPANY_WORDS = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'inc', 'corp', 'corporation', 'co', 'company', 'companies', 'the', 'and', 'of',
  'group', 'holdings', 'holding', 'management', 'services', 'service', 'solutions', 'international', 'global',
  'enterprises', 'enterprise', 'trading', 'partners', 'partnership', 'associates', 'london', 'uk', 'gb', 'england',
  'britain', 'british', 'scotland', 'wales', 'ireland', 'ie', 'europe', 'cic',
]);

/** Domain endings stripped before reading the company part of a domain. */
const SUFFIX_LABELS = new Set([
  'com', 'co', 'uk', 'org', 'net', 'io', 'ie', 'eu', 'biz', 'info', 'me', 'ltd', 'plc', 'gov', 'ac', 'london', 'scot',
  'wales', 'cymru', 'app', 'dev', 'ai', 'online', 'site', 'store', 'shop', 'tech', 'agency', 'studio', 'group', 'global',
  'world', 'live', 'one', 'xyz', 'us', 'ca', 'au', 'de', 'fr', 'es', 'nl', 'cloud', 'email', 'services', 'solutions',
]);

/** Lowercase words of a name: accents removed, "&" read as "and", split on anything that is not a letter or digit. */
function words(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.slice(0, 200).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/** The distinctive words of a company name (generic words removed), in order, without repeats. */
export function brandTokens(name: unknown): string[] {
  return [...new Set(words(name).filter((w) => !GENERIC_COMPANY_WORDS.has(w)))];
}

/**
 * The company part of a domain, with hyphens removed: mail.love-living.co.uk gives "loveliving". Null when nothing
 * is left after the endings are removed.
 */
export function domainLabel(domain: string): string | null {
  const parts = domain.trim().toLowerCase().split('.').filter(Boolean);
  while (parts.length > 1 && SUFFIX_LABELS.has(parts[parts.length - 1]!)) parts.pop();
  const last = parts[parts.length - 1] ?? '';
  if (SUFFIX_LABELS.has(last)) return null; // only endings, e.g. co.uk
  const label = last.replace(/-/g, '');
  return /^[a-z0-9]{2,63}$/.test(label) ? label : null;
}

/** True when `label` can be written entirely as a run of `vocab` words (each word used any number of times). */
function segmentable(label: string, vocab: string[]): boolean {
  const ok: boolean[] = new Array(label.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < label.length; i++) {
    if (!ok[i]) continue;
    for (const w of vocab) if (w && label.startsWith(w, i)) ok[i + w.length] = true;
  }
  return ok[label.length]!;
}

/**
 * Strict fit: the domain's company part is made only of the brand's words plus generic words, and contains every
 * word in `required` (default: all brand words). "Love Living Management" fits loveliving.uk and
 * lovelivingmanagement.com, but not livingsocial.com or lovelivingbrands.com. A name with no brand words fits nothing.
 */
export function domainFitsBrand(domain: string, brand: string[], required: string[] = brand): boolean {
  const label = domainLabel(domain);
  if (!label || brand.length === 0 || required.length === 0) return false;
  if (!required.every((t) => label.includes(t))) return false;
  return segmentable(label, [...brand, ...GENERIC_COMPANY_WORDS]);
}

/** The words that identify WHICH company it is: brand words without industry words ("Sparkle Cleaning" gives sparkle). */
export function distinctiveTokens(name: unknown): string[] {
  return brandTokens(name).filter((w) => !INDUSTRY_WORDS.has(w));
}

/**
 * Strict brand fit for one of the company's names: the domain's company part contains EVERY distinctive word in
 * full and is made only of the name's own words plus generic words. A name with no distinctive word
 * ("London Cleaning Services") fits nothing, so a supplier's domain such as cleaningwebdesigns.co.uk never fits.
 */
export function domainFitsNames(domain: string, names: string[]): boolean {
  const label = domainLabel(domain);
  if (!label) return false;
  for (const name of names) {
    const distinct = distinctiveTokens(name);
    if (distinct.length === 0) continue;
    if (!distinct.every((t) => label.includes(t))) continue;
    if (segmentable(label, [...brandTokens(name), ...GENERIC_COMPANY_WORDS])) return true;
  }
  return false;
}

/** How strongly Hunter's company-name answer points at this company. */
export type HunterNameMatch = 'strong' | 'weak' | 'none';

/**
 * Whether Hunter's best match for a company-name search plausibly IS this company, for one of the lead's names
 * (trading or registered):
 * - none: the domain does not fit the name strictly, or Hunter's organisation name has a distinctive word the
 *   lead's name lacks, or shares none of its distinctive words ("Living Social", "Love Living Brands").
 * - strong: ONLY when the Companies House registered name is known and Hunter's organisation name has exactly the
 *   same distinctive words (an independent registry fact agrees with Hunter). A match on the lead's own business
 *   name alone is never strong: "Love Living" never accepts lovelivinguk.co.uk on the name alone.
 * - weak: everything else that fits. A weak match is only accepted with a second, independent signal (see
 *   isCorroborated), for example a known person on Hunter's list for that domain.
 */
export function hunterNameMatches(leadNames: string[], organization: unknown, domain: string, registeredName?: string | null): HunterNameMatch {
  const org = distinctiveTokens(organization);
  const orgAll = brandTokens(organization);
  const registered = distinctiveTokens(registeredName ?? '');
  const sameSet = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && a.every((t) => b.includes(t));
  let best: HunterNameMatch = 'none';
  for (const name of leadNames) {
    const brand = brandTokens(name);
    const distinct = distinctiveTokens(name);
    if (distinct.length === 0 || !domainFitsNames(domain, [name])) continue;
    if (orgAll.length > 0) {
      if (orgAll.some((t) => !brand.includes(t))) continue;
      if (!org.some((t) => distinct.includes(t))) continue;
      if (sameSet(org, registered)) return 'strong';
    }
    best = 'weak';
  }
  return best;
}

/** A person known to work at the company (an officer, an owner name on the lead, a contact). */
export interface KnownPersonName { first: string; last: string }

function personKey(v: unknown): string {
  return typeof v === 'string' ? v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '') : '';
}

/**
 * True when Hunter's address list for a domain (`data.emails[]`) names one of the known people: the same surname and
 * the same first initial. Every field is type-checked. This "confirmed by a person" signal is what lets a domain be
 * saved and its staff stored.
 */
export function listNamesKnownPerson(emails: unknown, people: KnownPersonName[]): boolean {
  if (!Array.isArray(emails) || people.length === 0) return false;
  return emails.slice(0, 200).some((raw) => {
    if (typeof raw !== 'object' || raw === null) return false;
    const e = raw as Record<string, unknown>;
    const last = personKey(e.last_name);
    const first = personKey(e.first_name);
    return !!last && !!first && people.some((p) => personKey(p.last) === last && personKey(p.first)[0] === first[0]);
  });
}

/**
 * Plausible company domains built from the company's names, for checking with DNS: the name's distinctive and brand
 * words joined (loveliving), with and without uk / london / management / ltd, on .uk, .co.uk, .com, .london and
 * .org.uk. At most 12, most likely first. Every value is a plain hostname.
 */
export function candidateDomainsFromNames(names: string[], max = 12): string[] {
  const bases: string[] = [];
  for (const name of names) {
    const brand = brandTokens(name).filter((t) => /^[a-z0-9]+$/.test(t));
    if (distinctiveTokens(name).length === 0 || brand.length === 0 || brand.length > 4) continue;
    const base = brand.join('');
    if (base.length >= 3 && base.length <= 40 && !bases.includes(base)) bases.push(base);
  }
  const out: string[] = [];
  const add = (d: string) => { if (out.length < max && !out.includes(d)) out.push(d); };
  for (const base of bases) for (const tld of ['.uk', '.co.uk', '.com']) add(`${base}${tld}`);
  for (const base of bases) {
    add(`${base}uk.co.uk`); add(`${base}.london`); add(`${base}.org.uk`); add(`${base}london.co.uk`);
    add(`${base}management.co.uk`); add(`${base}ltd.co.uk`); add(`${base}uk.com`); add(`${base}-uk.co.uk`);
  }
  return out;
}

/**
 * Reads a DNS-over-HTTPS JSON answer for an MX query: 'mx' when there is at least one real mail server, 'none' for
 * NXDOMAIN, no answers or a null MX ("0 ."), and 'error' for anything malformed. Only type-15 answers count.
 */
export function parseDohMx(json: unknown): 'mx' | 'none' | 'error' {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return 'error';
  const o = json as Record<string, unknown>;
  if (typeof o.Status !== 'number') return 'error';
  if (o.Status === 3) return 'none';
  if (o.Status !== 0) return 'error';
  const answers = Array.isArray(o.Answer) ? o.Answer.slice(0, 20) : [];
  const real = answers.some((a) => {
    if (typeof a !== 'object' || a === null) return false;
    const r = a as Record<string, unknown>;
    if (r.type !== 15 || typeof r.data !== 'string') return false;
    const host = r.data.trim().split(/\s+/)[1] ?? '';
    return host !== '' && host !== '.';
  });
  return real ? 'mx' : 'none';
}

/** Why the lead's website may belong to a different company. */
export interface WebsiteSuspicion { suspect: boolean; reasons: string[] }

/**
 * Conservative check that the lead's website is really this (UK) company's: suspect when the pages show phone numbers
 * only from other countries (not +44 or +353, and no UK-style 0... number), or when neither the home page title nor
 * its footer carries the company's distinctive name words. Each reason is a fixed sentence.
 */
export function websiteSuspicion(pages: string[], names: string[]): WebsiteSuspicion {
  const reasons: string[] = [];
  const all = pages.slice(0, 6).map((p) => (typeof p === 'string' ? p.slice(0, 600_000) : '')).join('\n');
  if (!all) return { suspect: false, reasons };
  const text = all.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  let uk = 0;
  let foreign = 0;
  for (const m of text.matchAll(/\+\s?(\d{1,3})[\s.(-]{0,2}\d/g)) {
    if (m[1] === '44' || m[1] === '353') uk++; else foreign++;
  }
  for (const m of all.matchAll(/tel:\s*\+?(\d{1,3})/gi)) { if (m[1] === '44' || m[1] === '353') uk++; }
  if (/(^|[^\d+])0\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/.test(text)) uk++;
  if (foreign > 0 && uk === 0) reasons.push('The phone numbers on the website are not UK numbers.');
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(pages[0] ?? '')?.[1] ?? '';
  const footer = /(©|&copy;|copyright)[\s\S]{0,200}/i.exec(text)?.[0] ?? '';
  const carries = (s: string) => names.some((n) => {
    const d = distinctiveTokens(n);
    const w = brandTokens(s);
    return d.length > 0 && d.every((t) => w.includes(t) || w.join('').includes(t));
  });
  if (title.trim() && !carries(title) && !carries(footer)) reasons.push('The website title and footer name a different business.');
  return { suspect: reasons.length > 0, reasons };
}

const EMAIL_IN_HTML = /(?:mailto:)?([a-z0-9._%+-]{1,64}@([a-z0-9-]+(?:\.[a-z0-9-]+)+))/gi;
const HREF_IN_HTML = /href\s*=\s*["']\s*(https?:\/\/[^"'\s<>]{1,300})/gi;

/**
 * Other domains the company's own website points at: email addresses (mailto or plain text) and outbound links on a
 * different domain that fits one of the company's names strictly (domainFitsNames). Free-mail, social, directory and
 * internal hosts are refused through `checks`. The page is data only. Each is one weak signal on its own.
 */
export function domainHintsFromHtml(
  html: unknown, names: string[], websiteDomain: string | null, checks: DomainChecks,
): DomainCandidate[] {
  if (typeof html !== 'string') return [];
  const page = html.slice(0, 600_000);
  const own = websiteDomain ? checks.clean(websiteDomain) : null;
  const out: DomainCandidate[] = [];
  const add = (raw: unknown, source: DomainSource) => {
    const d = checks.clean(raw);
    if (!d || d === own || out.length >= 12 || out.some((c) => c.domain === d && c.source === source)) return;
    if (!checks.usable(d) || !domainFitsNames(d, names)) return;
    out.push({ domain: d, source });
  };
  for (const m of page.matchAll(EMAIL_IN_HTML)) add(m[2], 'website_email');
  for (const m of page.matchAll(HREF_IN_HTML)) {
    let host = '';
    try { host = new URL(m[1]!).hostname; } catch { continue; }
    add(host, 'website_link');
  }
  return out;
}

/** A person's name as the web search gave it: letters, spaces, apostrophes, dots and hyphens, two words or more. */
function cleanPersonName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 60 || !/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(t)) return null;
  return t.split(' ').length >= 2 ? t : null;
}

function cleanRole(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.replace(/[^\p{L}\p{M}0-9 &,/'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || null;
}

/**
 * Strictly reads the company web-search answer. Only one JSON object counts:
 * {"websites": [...], "email_domains": [...], "people": [{"name": ..., "role": ...}]}. Every domain must pass
 * `checks` and fit one of the company's names strictly (domainFitsNames); people need a plain two-word name. At most 6 domains and 8 people. Anything
 * else in the answer is ignored.
 */
export function parseDiscoveryAnswer(
  text: unknown, names: string[], checks: DomainChecks,
): { domains: string[]; people: WebPerson[] } {
  const none = { domains: [], people: [] };
  if (typeof text !== 'string' || text.length > 20_000) return none;
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open < 0 || close <= open) return none;
  let obj: unknown;
  try { obj = JSON.parse(text.slice(open, close + 1)); } catch { return none; }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return none;
  const o = obj as Record<string, unknown>;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 10) : []);
  const domains: string[] = [];
  for (const raw of [...list(o.websites), ...list(o.email_domains)]) {
    const d = checks.clean(typeof raw === 'string' ? raw.replace(/^.*@/, '') : null);
    if (d && !domains.includes(d) && domains.length < 6 && checks.usable(d) && domainFitsNames(d, names)) domains.push(d);
  }
  const people: WebPerson[] = [];
  for (const raw of list(o.people)) {
    if (typeof raw !== 'object' || raw === null || people.length >= 8) continue;
    const p = raw as Record<string, unknown>;
    const name = cleanPersonName(p.name);
    if (name && !people.some((x) => x.name.toLowerCase() === name.toLowerCase())) people.push({ name, role: cleanRole(p.role) });
  }
  return { domains, people };
}

/**
 * Merges sightings into one entry per domain (cleaned and checked again), strongest source first, and keeps at most
 * `max`, corroborated domains first. A domain that is not corroborated (isCorroborated) is `needs_check`: it may be
 * searched, but people found on it are suggestions only and it is never saved or shown as fact.
 */
export function rankDomains(candidates: DomainCandidate[], checks: DomainChecks, max = MAX_DISCOVERED_DOMAINS): DiscoveredDomain[] {
  const byDomain = new Map<string, DomainSource[]>();
  for (const c of candidates) {
    const d = checks.clean(c.domain);
    if (!d || !checks.usable(d) || !(c.source in SOURCE_RANK)) continue;
    const list = byDomain.get(d) ?? [];
    if (!list.includes(c.source)) list.push(c.source);
    byDomain.set(d, list);
  }
  const best = (s: DomainSource[]) => Math.min(...s.map((x) => SOURCE_RANK[x]));
  return [...byDomain.entries()]
    .map(([domain, sources]) => ({
      domain, sources: [...sources].sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b]),
      needs_check: !isCorroborated(sources),
    }))
    .sort((a, b) => Number(a.needs_check) - Number(b.needs_check) || best(a.sources) - best(b.sources) || a.domain.localeCompare(b.domain))
    .slice(0, max);
}

/** A domain safe to put into a fixed sentence (lowercase letters, digits, dots, hyphens; at most 80 characters). */
function sentenceDomain(d: string): string {
  return d.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
}

/** Fixed sentence for the discovery step, e.g. "Looked for the company's other domains: found loveliving.uk." */
export function discoveryDetail(found: DiscoveredDomain[]): string {
  const shown = found.filter((d) => !d.needs_check).map((d) => sentenceDomain(d.domain)).filter(Boolean);
  const checking = found.filter((d) => d.needs_check).length;
  if (shown.length === 0 && checking === 0) return 'Looked for the company\'s other domains but found none.';
  const parts: string[] = [];
  if (shown.length > 0) parts.push(`found ${shown.join(', ')}`);
  if (checking > 0) parts.push(`${checking} more seen only once, used for searching only`);
  return `Looked for the company's other domains: ${parts.join('; ')}.`;
}

/** Plain label for where a domain came from, for the results view. */
export const DOMAIN_SOURCE_LABELS: Record<DomainSource, string> = {
  typed: 'typed by you', website: 'the lead\'s website', website_suspect: 'the lead\'s website (may be another company)',
  saved: 'found earlier', lead_email: 'the lead\'s email', contact_email: 'a contact\'s email',
  person_confirmed: 'a known person was found on it', hunter_name: 'Hunter company search, matches the registered name',
  hunter_name_weak: 'Hunter company search (needs a second sign)', website_email: 'an email on the website',
  website_link: 'a link on the website', web: 'web search, check it',
};

/** What one discovery run may call. Each provider must never throw and must respect its timeout. */
export interface DiscoveryDeps {
  now: () => number;
  /** Hunter domain-search by company name: the best-match domain and organisation name. */
  hunterByName: (name: string, timeoutMs: number) => Promise<{ ok: true; domain: unknown; organization: unknown } | { ok: false; failure: unknown }>;
  /** Reads the lead's website (home + contact/about pages) and returns the raw HTML of each page read. */
  readSite: (website: string, budgetMs: number) => Promise<string[]>;
  /** Gemini grounded search; returns the raw answer text. */
  webSearch: (timeoutMs: number) => Promise<{ ok: true; text: string } | { ok: false; failure: unknown }>;
  /** DNS-over-HTTPS MX check for a validated hostname. Optional: without it no name-built domains are probed. */
  mx?: (domain: string, timeoutMs: number) => Promise<'mx' | 'none' | 'error'>;
  /** Hunter company list for a domain (limit 10): organisation name and addresses. */
  hunterList?: (domain: string, timeoutMs: number) => Promise<{ ok: true; organization: unknown; emails: unknown[] } | { ok: false; failure: unknown }>;
  /** Hunter email-finder by COMPANY NAME for one person: the address found and Hunter's score. */
  hunterFindByCompany?: (company: string, first: string, last: string, timeoutMs: number) => Promise<{ ok: true; email: unknown; score: unknown } | { ok: false; failure: unknown }>;
}

/** What is known before discovery starts. */
export interface DiscoveryInput {
  /** The trading name first, then the registered name when known. */
  names: string[];
  /** The Companies House registered name, when known (the only name that makes a Hunter name match strong). */
  registeredName?: string | null;
  /** People known to work there (officers, names on the lead, contacts), for "confirmed by a person". */
  people?: KnownPersonName[];
  website: string | null;
  websiteDomain: string | null;
  /** When true, the website is not read for other domains (it may belong to another company). */
  websiteSuspect?: boolean;
  /** Domains already known (typed, website, saved, emails), in priority order. */
  known: DomainCandidate[];
  /** Domains the user said are not the company's: never returned. */
  blocked?: string[];
  allow: { hunter: boolean; site: boolean; web: boolean };
  budgetMs: number;
}

/** The result of one discovery run. */
export interface DiscoveryOutcome {
  /** All domains to search, known ones included, ranked, at most MAX_DISCOVERED_DOMAINS. */
  domains: DiscoveredDomain[];
  /** Only the domains that were not known before. */
  discovered: DiscoveredDomain[];
  people: WebPerson[];
  hunterCalls: number;
  aiCalls: number;
  /** Safe failure codes of providers that did not work, for the summary. */
  failures: string[];
  /** Plain-English lines about how domains were found or checked. */
  notes: string[];
}

const FINDER_MIN_SCORE = 50;

/**
 * Discovers the company's other domains, never trusting one source:
 * 1. Hunter company-name search for each name (strong only with a registered-name match, else weak).
 * 2. For up to 3 known people, Hunter email-finder by company name: a confident address (score >= 50) puts its domain
 *    in as "confirmed by a person".
 * 3. Domains built from the names (candidateDomainsFromNames) that have a mail server (MX); for up to 4 of them
 *    Hunter's company list (limit 10): a known person on it confirms the domain; an organisation name equal to the
 *    registered name makes it strong; anything else is only a weak signal. A parked domain with MX but no Hunter
 *    match is never accepted.
 * 4. Other domains the company's own website points at (skipped when the website is suspect).
 * 5. A web search last, with whatever time is left.
 * Hunter calls stop as soon as a provider gate refuses (credit cap). Blocked domains are dropped everywhere.
 */
export async function runDomainDiscovery(input: DiscoveryInput, deps: DiscoveryDeps, checks: DomainChecks): Promise<DiscoveryOutcome> {
  const start = deps.now();
  const left = () => input.budgetMs - (deps.now() - start);
  const names = input.names.map((n) => n.trim()).filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i).slice(0, 2);
  const blocked = new Set((input.blocked ?? []).map((b) => checks.clean(b)).filter((b): b is string => !!b));
  const seen: DomainCandidate[] = [...input.known];
  const failures: string[] = [];
  const notes: string[] = [];
  const people = (input.people ?? []).slice(0, 6);
  let hunterCalls = 0;
  let aiCalls = 0;
  let webPeople: WebPerson[] = [];
  let hunterRefused = false;
  const usable = (raw: unknown): string | null => {
    const d = checks.clean(raw);
    return d && checks.usable(d) && !blocked.has(d) ? d : null;
  };
  const failed = (who: string, failure: unknown) => {
    const f = String(failure).slice(0, 20);
    if (f === 'cap_reached') hunterRefused = true;
    failures.push(`${who}:${f}`);
  };

  if (input.allow.hunter) {
    for (const name of names) {
      if (hunterRefused || left() < 1_500 || brandTokens(name).length === 0) continue;
      hunterCalls++;
      const res = await deps.hunterByName(name, Math.min(5_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
      if (!res.ok) { failed('hunter', res.failure); continue; }
      const d = usable(res.domain);
      const match = d ? hunterNameMatches(names, res.organization, d, input.registeredName) : 'none';
      if (d && match !== 'none') seen.push({ domain: d, source: match === 'strong' ? 'hunter_name' : 'hunter_name_weak' });
    }
    const company = (input.registeredName ?? names[0] ?? '').trim();
    if (deps.hunterFindByCompany && company) {
      for (const p of people.slice(0, 3)) {
        if (hunterRefused || left() < 2_000) break;
        hunterCalls++;
        const res = await deps.hunterFindByCompany(company, p.first, p.last, Math.min(5_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
        if (!res.ok) { failed('hunter', res.failure); continue; }
        const score = typeof res.score === 'number' ? res.score : 0;
        const email = typeof res.email === 'string' ? res.email.trim().toLowerCase() : '';
        const d = score >= FINDER_MIN_SCORE && email.includes('@') ? usable(email.slice(email.lastIndexOf('@') + 1)) : null;
        if (d) {
          seen.push({ domain: d, source: 'person_confirmed' });
          notes.push(`Hunter found ${p.first} ${p.last} at ${d}.`.slice(0, 200));
        }
      }
    }
    if (deps.mx && deps.hunterList) {
      const knownDomains = new Set(seen.map((s) => checks.clean(s.domain)));
      let probed = 0;
      for (const candidate of candidateDomainsFromNames([input.registeredName ?? '', ...names].filter(Boolean))) {
        if (hunterRefused || probed >= 4 || left() < 3_000) break;
        const d = usable(candidate);
        if (!d || knownDomains.has(d)) continue;
        const mx = await deps.mx(d, Math.min(3_000, left())).catch(() => 'error' as const);
        if (mx !== 'mx') continue;
        probed++;
        hunterCalls++;
        const res = await deps.hunterList(d, Math.min(5_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
        if (!res.ok) { failed('hunter', res.failure); continue; }
        if (listNamesKnownPerson(res.emails, people)) {
          seen.push({ domain: d, source: 'person_confirmed' });
          notes.push(`Domain ${d} has a mail server and Hunter lists a known person there.`);
        } else {
          const match = hunterNameMatches(names, res.organization, d, input.registeredName);
          if (match === 'strong') seen.push({ domain: d, source: 'hunter_name' });
          else if (match === 'weak') seen.push({ domain: d, source: 'hunter_name_weak' });
          if (match !== 'none') notes.push(`Domain ${d} has a mail server and Hunter's name for it ${match === 'strong' ? 'matches the registered company' : 'is similar, but that alone is not enough'}.`);
        }
      }
    }
  }
  if (input.allow.site && input.website && !input.websiteSuspect && left() >= 3_000) {
    const pages = await deps.readSite(input.website, Math.min(10_000, left())).catch(() => [] as string[]);
    for (const html of pages) seen.push(...domainHintsFromHtml(html, names, input.websiteDomain, checks));
  }
  if (input.allow.web && left() >= 4_000) {
    aiCalls++;
    const res = await deps.webSearch(Math.min(15_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
    if (!res.ok) failures.push(`web:${String(res.failure).slice(0, 20)}`);
    else {
      const parsed = parseDiscoveryAnswer(res.text, names, checks);
      webPeople = parsed.people;
      for (const d of parsed.domains) seen.push({ domain: d, source: 'web' });
    }
  }
  const domains = rankDomains(seen.filter((s) => !blocked.has(checks.clean(s.domain) ?? '')), checks);
  const knownSet = new Set(input.known.map((k) => checks.clean(k.domain)).filter(Boolean));
  return { domains, discovered: domains.filter((d) => !knownSet.has(d.domain)), people: webPeople, hunterCalls, aiCalls, failures, notes };
}
