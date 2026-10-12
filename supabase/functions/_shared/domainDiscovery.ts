// supabase/functions/_shared/domainDiscovery.ts
// Pure helpers for discovering the other domains a company uses (for example a lead whose website is
// lovelivingmanagement.com while its people use loveliving.uk). No imports on purpose: tested from src/lib.
// Provider, page and model text is untrusted data: every domain is cleaned and checked by caller-supplied
// predicates (the existing hostname, SSRF and directory rules) and must also fit the company's brand words.

/** Where a domain came from, strongest first (see SOURCE_RANK). */
export type DomainSource =
  | 'typed' | 'website' | 'saved' | 'lead_email' | 'contact_email'
  | 'hunter_name' | 'hunter_name_weak' | 'website_email' | 'website_link' | 'web';

/** One sighting of a domain. */
export interface DomainCandidate { domain: string; source: DomainSource }

/**
 * A ranked, de-duplicated domain. `needs_check` is true when the domain is NOT corroborated (see isCorroborated):
 * it may be searched, but people found on it are only suggestions, and it is never saved or shown as fact.
 */
export interface DiscoveredDomain { domain: string; sources: DomainSource[]; needs_check: boolean }

/** Sources that on their own make a domain the company's: known to the user or the lead, or a strong Hunter name match. */
const STRONG_SOURCES: DomainSource[] = ['typed', 'website', 'saved', 'lead_email', 'contact_email', 'hunter_name'];
/** Independent weak signals: two different ones together corroborate a domain. */
const WEAK_SOURCES: DomainSource[] = ['hunter_name_weak', 'website_email', 'website_link', 'web'];

/**
 * True when a domain's sightings make it the company's own: one strong source (a typed domain, the lead's website, a
 * saved domain, the lead's or a contact's email domain, a strong Hunter company-name match), or at least two DIFFERENT
 * weak signals (a weak Hunter match, an email or link on the website, the web search).
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
  typed: 0, website: 1, saved: 2, lead_email: 3, contact_email: 4, hunter_name: 5, hunter_name_weak: 6, website_email: 7,
  website_link: 8, web: 9,
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
 * - strong: Hunter gave an organisation name, it carries every distinctive word, and there are at least two of them.
 * - weak: everything else that fits (no organisation name from Hunter, or a one-word brand such as "Bloom" where a
 *   namesake is likely). A weak match is only accepted with a second, independent signal (see isCorroborated).
 */
export function hunterNameMatches(leadNames: string[], organization: unknown, domain: string): HunterNameMatch {
  const org = distinctiveTokens(organization);
  const orgAll = brandTokens(organization);
  let best: HunterNameMatch = 'none';
  for (const name of leadNames) {
    const brand = brandTokens(name);
    const distinct = distinctiveTokens(name);
    if (distinct.length === 0 || !domainFitsNames(domain, [name])) continue;
    if (orgAll.length > 0) {
      if (orgAll.some((t) => !brand.includes(t))) continue;
      if (!org.some((t) => distinct.includes(t))) continue;
      if (distinct.length >= 2 && distinct.every((t) => org.includes(t))) return 'strong';
    }
    best = 'weak';
  }
  return best;
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
  typed: 'typed by you', website: 'the lead\'s website', saved: 'found earlier', lead_email: 'the lead\'s email',
  contact_email: 'a contact\'s email', hunter_name: 'Hunter company search',
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
}

/** What is known before discovery starts. */
export interface DiscoveryInput {
  /** The trading name first, then the registered name when known. */
  names: string[];
  website: string | null;
  websiteDomain: string | null;
  /** Domains already known (typed, website, saved, emails), in priority order. */
  known: DomainCandidate[];
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
}

/**
 * Discovers the company's other domains: Hunter company-name search for each name (strong or weak per
 * hunterNameMatches), domains the company's own website points at, and finally a web search (last, with whatever
 * time is left). Each source only runs when allowed and while budget remains; a failure never stops the next.
 */
export async function runDomainDiscovery(input: DiscoveryInput, deps: DiscoveryDeps, checks: DomainChecks): Promise<DiscoveryOutcome> {
  const start = deps.now();
  const left = () => input.budgetMs - (deps.now() - start);
  const names = input.names.map((n) => n.trim()).filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i).slice(0, 2);
  const seen: DomainCandidate[] = [...input.known];
  const failures: string[] = [];
  let hunterCalls = 0;
  let aiCalls = 0;
  let people: WebPerson[] = [];

  if (input.allow.hunter) {
    for (const name of names) {
      if (left() < 1_500 || brandTokens(name).length === 0) continue;
      hunterCalls++;
      const res = await deps.hunterByName(name, Math.min(5_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
      if (!res.ok) { failures.push(`hunter:${String(res.failure).slice(0, 20)}`); continue; }
      const d = checks.clean(res.domain);
      const match = d && checks.usable(d) ? hunterNameMatches(names, res.organization, d) : 'none';
      if (d && match !== 'none') seen.push({ domain: d, source: match === 'strong' ? 'hunter_name' : 'hunter_name_weak' });
    }
  }
  if (input.allow.site && input.website && left() >= 3_000) {
    const pages = await deps.readSite(input.website, Math.min(10_000, left())).catch(() => [] as string[]);
    for (const html of pages) seen.push(...domainHintsFromHtml(html, names, input.websiteDomain, checks));
  }
  if (input.allow.web && left() >= 4_000) {
    aiCalls++;
    const res = await deps.webSearch(Math.min(15_000, left())).catch(() => ({ ok: false as const, failure: 'network' }));
    if (!res.ok) failures.push(`web:${String(res.failure).slice(0, 20)}`);
    else {
      const parsed = parseDiscoveryAnswer(res.text, names, checks);
      people = parsed.people;
      for (const d of parsed.domains) seen.push({ domain: d, source: 'web' });
    }
  }
  const domains = rankDomains(seen, checks);
  const knownSet = new Set(input.known.map((k) => checks.clean(k.domain)).filter(Boolean));
  return { domains, discovered: domains.filter((d) => !knownSet.has(d.domain)), people, hunterCalls, aiCalls, failures };
}
