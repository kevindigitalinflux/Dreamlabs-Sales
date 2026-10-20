// supabase/functions/_shared/domainDiscovery.ts
// Pure helpers for discovering the other domains a company uses (for example a lead whose website is
// lovelivingmanagement.com while its people use loveliving.uk). Imports only import-free modules: tested from src/lib.
// Provider, page and model text is untrusted data: every domain is cleaned and checked by caller-supplied
// predicates (the existing hostname, SSRF and directory rules) and must also fit the company's brand words.

import { siteConfirmLine, siteConfirmsCompany } from './domainSiteCheck.ts';
import { isDirectoryDomain } from './knownPerson.ts';
import { countryPhoneMismatch } from './deepFindSuggestions.ts';

/** Where a domain came from, strongest first (see SOURCE_RANK). */
export type DomainSource =
  | 'typed' | 'website' | 'website_suspect' | 'saved' | 'lead_email' | 'contact_email' | 'person_confirmed'
  | 'hunter_name' | 'hunter_name_weak' | 'website_email' | 'website_link' | 'web' | 'apollo_org' | 'site_confirms';

/** One sighting of a domain. */
export interface DomainCandidate { domain: string; source: DomainSource }

/**
 * A ranked, de-duplicated domain. `needs_check` is true when the domain is NOT corroborated (see isCorroborated):
 * it may be searched, but people found on it are only suggestions, and it is never saved or shown as fact.
 */
export interface DiscoveredDomain { domain: string; sources: DomainSource[]; needs_check: boolean }

/** Sources that on their own make a domain the company's: known to the user or the lead, or a strong Hunter name match. */
const STRONG_SOURCES: DomainSource[] = ['typed', 'website', 'saved', 'lead_email', 'contact_email', 'person_confirmed', 'site_confirms', 'hunter_name'];
/** Independent weak signals: two different ones together corroborate a domain. */
const WEAK_SOURCES: DomainSource[] = ['website_suspect', 'hunter_name_weak', 'website_email', 'website_link', 'web', 'apollo_org'];

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
  hunter_name_weak: 8, website_email: 9, website_link: 10, web: 11, apollo_org: 12, site_confirms: 5.5,
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
/** Match whole company abbreviations, including UK + R + Management and UKR Mgmt. */
function abbreviatedName(value: string, name: string): boolean {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !['limited', 'ltd', 'llp', 'plc', 'the', 'and'].includes(w));
  if (words.length < 2) return false;
  const tokens = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const initials = [words.map(w => w[0]).join(''), words.map(w => w.length <= 2 ? w : w[0]).join('')];
  if (tokens.some(t => t.length >= 3 && initials.includes(t))) return true;
  const choices = words.map(w => [w, ...(w.length > 2 ? [w[0]] : []), ...(w === 'management' ? ['mgmt'] : [])]);
  const variants = choices.reduce<string[]>((out, parts) => out.flatMap(prefix => parts.map(p => prefix + p)).slice(0, 128), ['']);
  return variants.some(v => v.length >= 4 && (tokens.includes(v) || tokens.join('') === v));
}

interface SiteIdentity { phone?: unknown; postcode?: unknown; email?: unknown; website?: unknown }
/** Saved values must occur on the site. Generic numbers and partial email/postcode matches provide no proof. */
function siteContactEvidence(text: string, lead: SiteIdentity): string | null {
  const phoneKey = (s: string) => s.replace(/\D/g, '').replace(/^(?:0044|44)0?/, '').replace(/^0/, '');
  if (typeof lead.phone === 'string' && phoneKey(lead.phone).length >= 9) {
    for (const m of text.matchAll(/\+?\d[\d ().-]{7,}\d/g)) {
      const before = text.slice(Math.max(0, m.index! - 30), m.index).toLowerCase();
      if ((/\b(call|phone|tel|telephone|mobile|contact)\b/.test(before) || /[+() -]/.test(m[0]))
        && !/\b(company|registration|account|vat)\b/.test(before) && phoneKey(m[0]) === phoneKey(lead.phone)) return 'phone';
    }
  }
  if (typeof lead.postcode === 'string') {
    const pc = lead.postcode.toUpperCase().replace(/\s/g, '');
    if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc) && new RegExp(`\\b${pc.slice(0, -3)}\\s*${pc.slice(-3)}\\b`, 'i').test(text)) return 'postcode';
  }
  if (typeof lead.email === 'string') {
    const saved = lead.email.trim().toLowerCase();
    const domain = saved.split('@')[1];
    for (const m of text.matchAll(/[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      if (m[0].toLowerCase() === saved || (domain && m[1].toLowerCase() === domain && !['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com'].includes(domain))) return 'email';
    }
  }
  return null;
}

export interface WebsiteSuspicion { suspect: boolean; reasons: string[] }

/**
 * Conservative check that the lead's website is really this (UK) company's: suspect when the pages show phone numbers
 * only from other countries (not +44 or +353, and no UK-style 0... number), or when neither the home page title nor
 * its footer carries the company's distinctive name words. Each reason is a fixed sentence.
 */
export function websiteSuspicion(pages: string[], names: string[], country?: unknown, lead: SiteIdentity = {}): WebsiteSuspicion {
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
  if (country === 'IE' || country === 'US') {
    const telephoneLinks = [...all.matchAll(/tel:([^"'<>]+)/gi)].map((m) => m[1]).join(' ');
    if (countryPhoneMismatch(`${text} ${telephoneLinks}`, country)) reasons.push('The phone numbers on the website do not match the lead’s country.');
  } else if (country !== 'OTHER' && foreign > 0 && uk === 0) reasons.push('The phone numbers on the website are not UK numbers.');
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(pages[0] ?? '')?.[1] ?? '';
  const footer = /(©|&copy;|copyright)[\s\S]{0,200}/i.exec(text)?.[0] ?? '';
  const carries = (s: string) => names.some((n) => {
    const d = distinctiveTokens(n);
    const w = brandTokens(s);
    return (d.length > 0 && d.every((t) => w.includes(t) || w.join('').includes(t))) || abbreviatedName(s, n);
  });
  let domainMatch = false;
  if (typeof lead.website === 'string') {
    try {
      const host = new URL(lead.website.includes('://') ? lead.website : `https://${lead.website}`).hostname.replace(/^www\./, '');
      if (isDirectoryDomain(host)) reasons.push('The website is a directory page, not the company’s own site.');
      domainMatch = names.some(n => abbreviatedName(host.split('.')[0], n));
    } catch { /* Invalid URLs provide no name evidence. */ }
  }
  const contact = siteContactEvidence(text, lead);
  if (title.trim() && !carries(title) && !carries(footer) && !domainMatch && !contact) reasons.push('The website title and footer name a different business.');
  const suspect = reasons.length > 0;
  if (contact) reasons.push(`confirmed by ${contact} on the site`);
  return { suspect, reasons };
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
  website_link: 'a link on the website', web: 'web search, check it', apollo_org: 'Apollo company search, check it',
  site_confirms: 'its own website names the company or a known person',
};

/**
 * One search step that did not give an answer, for the plain-English "why" lines (deepFindProblems.ts).
 * `target` is a name variant or a domain (already cleaned); `failure` is a safe code: an HTTP status, 'timeout',
 * 'network', 'bad_reply', 'no_mx' (the domain has no mail server) or 'dns_error'. Never provider text.
 */
export interface StepProblem {
  step: 'hunter_company' | 'hunter_finder' | 'hunter_list' | 'domain_check' | 'site_check' | 'web' | 'apollo';
  target: string;
  failure: string;
}

/** Safe failure code: a 3-digit status or one of the fixed words. Anything else becomes 'network'. */
export function safeFailure(failure: unknown): string {
  if (typeof failure === 'number' && Number.isInteger(failure) && failure >= 100 && failure <= 599) return String(failure);
  const f = String(failure);
  return ['timeout', 'network', 'bad_reply', 'no_mx', 'dns_error', 'unreadable', 'cap_reached', 'usage_exhausted', 'rate_limited'].includes(f) ? f : 'network';
}

/**
 * Reads an Apollo organisation search answer (POST /api/v1/mixed_companies/search, response shape UNVERIFIED):
 * `organizations[]` and `accounts[]`, each with optional `name`, `primary_domain` and `website_url`. A domain is kept
 * only when it passes `checks`, fits one of the company's names strictly (domainFitsNames) and the organisation name
 * has no distinctive word the company's names lack. At most 3. Every field is type-checked.
 */
export function apolloOrgDomains(json: unknown, names: string[], checks: DomainChecks): string[] {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return [];
  const o = json as Record<string, unknown>;
  const list = [
    ...(Array.isArray(o.organizations) ? o.organizations.slice(0, 10) : []),
    ...(Array.isArray(o.accounts) ? o.accounts.slice(0, 10) : []),
  ];
  const nameWords = names.flatMap((n) => brandTokens(n));
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null || out.length >= 3) continue;
    const r = raw as Record<string, unknown>;
    const orgWords = brandTokens(typeof r.name === 'string' ? r.name.slice(0, 200) : '');
    if (orgWords.length === 0 || orgWords.some((w) => !nameWords.includes(w))) continue;
    let host: unknown = r.primary_domain;
    if (typeof host !== 'string' && typeof r.website_url === 'string') {
      try { host = new URL(r.website_url.slice(0, 300)).hostname; } catch { host = null; }
    }
    const d = checks.clean(host);
    if (d && checks.usable(d) && domainFitsNames(d, names) && !out.includes(d)) out.push(d);
  }
  return out;
}

type Failed = { ok: false; failure: unknown };

/** What one discovery run may call. Each provider must never throw and must respect its timeout. */
export interface DiscoveryDeps {
  now: () => number;
  /** Hunter domain-search by company name: the best-match domain and organisation name. */
  hunterByName: (name: string, timeoutMs: number) => Promise<{ ok: true; domain: unknown; organization: unknown } | Failed>;
  /** Reads the lead's website (home + contact/about pages) and returns the raw HTML of each page read. */
  readSite: (website: string, budgetMs: number) => Promise<string[]>;
  /** Gemini grounded search; returns the raw answer text. */
  webSearch: (timeoutMs: number) => Promise<{ ok: true; text: string } | Failed>;
  /** DNS-over-HTTPS MX check for a validated hostname. Optional: without it no name-built domains are probed. */
  mx?: (domain: string, timeoutMs: number) => Promise<'mx' | 'none' | 'error'>;
  /** Hunter company list for a domain (limit 10): organisation name and addresses. */
  hunterList?: (domain: string, timeoutMs: number) => Promise<{ ok: true; organization: unknown; emails: unknown[] } | Failed>;
  /** Hunter email-finder by COMPANY NAME for one person: the address found and Hunter's score. */
  hunterFindByCompany?: (company: string, first: string, last: string, timeoutMs: number) => Promise<{ ok: true; email: unknown; score: unknown } | Failed>;
  /** Reads a discovered domain's own website (home + up to 5 team/about/contact pages); free, SSRF-guarded by the caller. */
  readDomainSite?: (domain: string, budgetMs: number) => Promise<string[]>;
  /** Apollo organisation search by name: the raw JSON answer (read by apolloOrgDomains). */
  apolloOrg?: (name: string, timeoutMs: number) => Promise<{ ok: true; json: unknown } | Failed>;
}

/** What is known before discovery starts. */
export interface DiscoveryInput {
  /** The trading name first, then the registered name when known. */
  names: string[];
  /**
   * Extra spellings to SEARCH with (companyNameVariants: "loveliving", "love-living", "loveliving london" ...). They
   * only widen searches: every domain found must still fit `names` and be corroborated.
   */
  variants?: string[];
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
  allow: { hunter: boolean; site: boolean; web: boolean; apollo?: boolean };
  budgetMs: number;
  /** At most this many Hunter requests in this discovery run (default MAX_DISCOVERY_HUNTER_CALLS). */
  hunterCap?: number;
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
  apolloCalls: number;
  /** Pages of discovered domains whose own website confirmed them (for the team scan and email format). */
  sitePages: { domain: string; pages: string[] }[];
  /** Search steps that gave no answer (failures and domains with no mail server), for the "why" lines. */
  problems: StepProblem[];
  /** Plain-English lines about how domains were found or checked. */
  notes: string[];
}

const FINDER_MIN_SCORE = 50;
/** Hunter requests one discovery run may make (about one credit each). */
export const MAX_DISCOVERY_HUNTER_CALLS = 12;
/** Name-built domains checked for a mail server (DNS only, free). */
const MAX_MX_CHECKS = 24;
/** Domains with a mail server that get a Hunter list. */
const MAX_PROBES = 4;
/** The web search's own time budget (it runs in parallel with the other steps). */
export const WEB_BUDGET_MS = 25_000;
/** Apollo organisation searches per lead. */
const MAX_APOLLO_CALLS = 2;
/** Statuses a by-company Hunter search returns when it simply found no company of that name. */
const NO_MATCH_STATUSES = new Set([400, 404, 451]);

/**
 * Discovers the company's other domains, never trusting one source. Searches use every name VARIANT; matches are
 * always judged against the company's real names.
 * 1. Hunter company-name search per variant, stopping once a domain is corroborated (a registered-name match is
 *    strong, anything else weak). A 400/404 is "no company of that name", not a failure.
 * 2. For up to 3 known people, Hunter email-finder by company name (registered name, then the variants), stopping at
 *    the first confident address (score >= 50): its domain is "confirmed by a person".
 * 3. Domains built from every name and variant (candidateDomainsFromNames) are checked for a mail server (DNS, in
 *    small parallel batches); for up to 4 with MX, Hunter's company list: a known person on it confirms the domain,
 *    an organisation name equal to the registered name makes it strong, anything else is weak.
 * 4. Apollo organisation search for the top 2 variants (weak signal only). A 401/402/403 means Apollo is not on the
 *    plan: one quiet note and no more Apollo calls, never a failure.
 * 5. Other domains the company's own website points at (skipped when the website is suspect).
 * 6. A web search, started first and run in parallel with its own budget (WEB_BUDGET_MS), awaited last.
 * Hunter requests stop at `hunterCap` or as soon as a provider gate refuses (credit cap). Blocked domains are dropped.
 */
export async function runDomainDiscovery(input: DiscoveryInput, deps: DiscoveryDeps, checks: DomainChecks): Promise<DiscoveryOutcome> {
  const start = deps.now();
  const left = () => input.budgetMs - (deps.now() - start);
  const names = input.names.map((n) => n.trim()).filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i).slice(0, 2);
  const searchNames = [...names, ...(input.variants ?? [])].map((n) => n.trim().slice(0, 120))
    .filter((n, i, a) => n && a.findIndex((x) => x.toLowerCase() === n.toLowerCase()) === i).slice(0, 8);
  const blocked = new Set((input.blocked ?? []).map((b) => checks.clean(b)).filter((b): b is string => !!b));
  // The web search starts NOW and runs alongside the Hunter, DNS and website steps with its own time budget, so a slow
  // search is no longer starved by the steps before it.
  const webTask = input.allow.web && input.budgetMs >= 4_000
    ? deps.webSearch(Math.min(WEB_BUDGET_MS, Math.max(4_000, input.budgetMs))).catch((): Failed => ({ ok: false, failure: 'network' }))
    : null;
  const seen: DomainCandidate[] = [...input.known];
  const problems: StepProblem[] = [];
  const sitePages: { domain: string; pages: string[] }[] = [];
  const notes: string[] = [];
  const people = (input.people ?? []).slice(0, 6);
  const cap = Math.max(0, Math.min(input.hunterCap ?? MAX_DISCOVERY_HUNTER_CALLS, 40));
  let hunterCalls = 0;
  const aiCalls = webTask ? 1 : 0;
  let apolloCalls = 0;
  let webPeople: WebPerson[] = [];
  let hunterRefused = false;
  const canHunter = (minLeft: number) => !hunterRefused && hunterCalls < cap && left() >= minLeft;
  const usable = (raw: unknown): string | null => {
    const d = checks.clean(raw);
    return d && checks.usable(d) && !blocked.has(d) ? d : null;
  };
  const failed = (step: StepProblem['step'], target: string, failure: unknown) => {
    const f = safeFailure(failure);
    if (f === 'cap_reached') { hunterRefused = step.startsWith('hunter') || hunterRefused; return; }
    problems.push({ step, target: target.slice(0, 80), failure: f });
    // A refused key, used-up searches or "slow down" (already retried once) will not change within this run: stop asking Hunter.
    if (step.startsWith('hunter') && ['401', '402', '429', 'usage_exhausted', 'rate_limited'].includes(f)) hunterRefused = true;
  };
  const confirmed = () => seen.some((s) => isCorroborated(seen.filter((x) => x.domain === s.domain).map((x) => x.source))
    && !blocked.has(s.domain));

  if (input.allow.hunter) {
    for (const name of searchNames) {
      if (!canHunter(1_500) || confirmed()) break;
      if (brandTokens(name).length === 0) continue;
      hunterCalls++;
      const res = await deps.hunterByName(name, Math.min(5_000, left())).catch((): Failed => ({ ok: false, failure: 'network' }));
      if (!res.ok) {
        if (!NO_MATCH_STATUSES.has(res.failure as number)) failed('hunter_company', name, res.failure);
        continue;
      }
      const d = usable(res.domain);
      const match = d ? hunterNameMatches(names, res.organization, d, input.registeredName) : 'none';
      if (d && match !== 'none') seen.push({ domain: d, source: match === 'strong' ? 'hunter_name' : 'hunter_name_weak' });
    }
    const companies = [input.registeredName ?? '', ...searchNames].map((c) => c.trim())
      .filter((c, i, a) => c && a.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i).slice(0, 3);
    if (deps.hunterFindByCompany && companies.length > 0) {
      search: for (const p of people.slice(0, 3)) {
        for (const company of companies) {
          if (!canHunter(2_000) || confirmed()) break search;
          hunterCalls++;
          const res = await deps.hunterFindByCompany(company, p.first, p.last, Math.min(5_000, left())).catch((): Failed => ({ ok: false, failure: 'network' }));
          if (!res.ok) {
            if (!NO_MATCH_STATUSES.has(res.failure as number)) failed('hunter_finder', company, res.failure);
            continue;
          }
          const score = typeof res.score === 'number' ? res.score : 0;
          const email = typeof res.email === 'string' ? res.email.trim().toLowerCase() : '';
          const d = score >= FINDER_MIN_SCORE && email.includes('@') ? usable(email.slice(email.lastIndexOf('@') + 1)) : null;
          if (d) {
            seen.push({ domain: d, source: 'person_confirmed' });
            notes.push(`Hunter found ${p.first} ${p.last} at ${d}.`.slice(0, 200));
            break search;
          }
        }
      }
    }
  }
  if (deps.mx) {
    const knownDomains = new Set(seen.map((s) => checks.clean(s.domain)));
    const candidates = candidateDomainsFromNames([input.registeredName ?? '', ...searchNames].filter(Boolean), MAX_MX_CHECKS)
      .map((c) => usable(c)).filter((d): d is string => !!d && !knownDomains.has(d));
    const withMx: string[] = [];
    for (let i = 0; i < candidates.length && left() >= 3_000; i += 6) {
      const batch = candidates.slice(i, i + 6);
      const results = await Promise.all(batch.map((d) => deps.mx!(d, Math.min(3_000, left())).catch(() => 'error' as const)));
      batch.forEach((d, j) => {
        if (results[j] === 'mx') withMx.push(d);
        else if (results[j] === 'error') problems.push({ step: 'domain_check', target: d, failure: 'dns_error' });
        else if (i + j < 3) problems.push({ step: 'domain_check', target: d, failure: 'no_mx' });
      });
    }
    if (withMx.length > 0) notes.push(`Domains with a mail server: ${withMx.slice(0, 6).join(', ')}.`.slice(0, 300));
    // Free check first: does the domain's own website name the company or a known person? (no credits)
    if (deps.readDomainSite) {
      const toRead = withMx.slice(0, MAX_PROBES).filter(() => left() >= 4_000);
      const read = await Promise.all(toRead.map((d) => deps.readDomainSite!(d, Math.min(10_000, Math.max(1, left() - 2_000))).catch(() => [] as string[])));
      toRead.forEach((d, i) => {
        const pages = read[i] ?? [];
        const c = siteConfirmsCompany(pages, searchNames, people);
        const line = siteConfirmLine(d, c);
        if (c.confirms && line) {
          seen.push({ domain: d, source: 'site_confirms' });
          sitePages.push({ domain: d, pages });
          notes.push(line);
        } else if (pages.length === 0) {
          problems.push({ step: 'site_check', target: d, failure: 'unreadable' });
        }
      });
    }
    if (input.allow.hunter && deps.hunterList) {
      for (const d of withMx.slice(0, MAX_PROBES)) {
        if (!canHunter(3_000) || confirmed()) break;
        hunterCalls++;
        const res = await deps.hunterList(d, Math.min(5_000, left())).catch((): Failed => ({ ok: false, failure: 'network' }));
        if (!res.ok) { failed('hunter_list', d, res.failure); continue; }
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
  if (input.allow.apollo && deps.apolloOrg) {
    for (const name of searchNames.slice(0, MAX_APOLLO_CALLS)) {
      if (left() < 3_000 || confirmed()) break;
      apolloCalls++;
      const res = await deps.apolloOrg(name, Math.min(6_000, left())).catch((): Failed => ({ ok: false, failure: 'network' }));
      if (!res.ok) {
        if (res.failure === 401 || res.failure === 402 || res.failure === 403) {
          notes.push('Apollo company search is not available on your Apollo plan, so it was skipped.');
          break;
        }
        failed('apollo', name, res.failure);
        continue;
      }
      for (const d of apolloOrgDomains(res.json, names, checks)) if (usable(d)) seen.push({ domain: d, source: 'apollo_org' });
    }
  }
  if (input.allow.site && input.website && !input.websiteSuspect && left() >= 3_000) {
    const pages = await deps.readSite(input.website, Math.min(10_000, left())).catch(() => [] as string[]);
    for (const html of pages) seen.push(...domainHintsFromHtml(html, names, input.websiteDomain, checks));
  }
  if (webTask) {
    const res = await webTask;
    if (!res.ok) failed('web', 'company', res.failure);
    else {
      const parsed = parseDiscoveryAnswer(res.text, names, checks);
      webPeople = parsed.people;
      for (const d of parsed.domains) seen.push({ domain: d, source: 'web' });
    }
  }
  const domains = rankDomains(seen.filter((s) => !blocked.has(checks.clean(s.domain) ?? '')), checks);
  const knownSet = new Set(input.known.map((k) => checks.clean(k.domain)).filter(Boolean));
  return { domains, discovered: domains.filter((d) => !knownSet.has(d.domain)), people: webPeople, hunterCalls, aiCalls, apolloCalls, problems, notes, sitePages };
}
