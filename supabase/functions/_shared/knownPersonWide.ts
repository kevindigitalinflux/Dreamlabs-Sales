// supabase/functions/_shared/knownPersonWide.ts
// Pure helpers for the wider known-person lookup (Hunter company list, email pattern, the company's own website,
// web search). No imports on purpose: tested from src/lib. Everything here treats provider, page and model text as
// untrusted data: values are validated and only fixed strings or validated fields ever leave these functions.

/** The lookup steps, in the order they run. */
export type StepId = 'hunter_finder' | 'hunter_domain' | 'pattern' | 'website' | 'web' | 'apollo';

/** What happened in one step. */
export type StepStatus = 'found' | 'no_match' | 'skipped' | 'unavailable' | 'error';

/** One step as reported to the result panel. `detail` is always a fixed, plain-English sentence. */
export interface StepResult { id: StepId; label: string; status: StepStatus; detail: string }

/** A value the lookup found but did not save, offered to the user with a one-click "Use this". */
export interface Suggestion { field: 'email' | 'linkedin_url'; value: string; label: string }

/** Fixed step names shown in the result panel. */
export const STEP_LABELS: Record<StepId, string> = {
  hunter_finder: 'Hunter email finder',
  hunter_domain: 'Hunter company list',
  pattern: 'Company email pattern',
  website: 'Company website',
  web: 'Web search',
  apollo: 'Apollo',
};

/** Fixed labels for suggestions. */
export const SUGGESTION_LABELS = {
  guess: 'Guess, unverified',
  web: 'Found by web search, check it',
} as const;

/** Builds one step record with its fixed label. */
export function stepResult(id: StepId, status: StepStatus, detail: string): StepResult {
  return { id, label: STEP_LABELS[id], status, detail };
}

/** A name safe to put into a fixed detail sentence: letters, spaces, apostrophes and hyphens only, at most 60 characters. */
export function displayName(value: string | null | undefined): string {
  const t = (value ?? '').replace(/[^\p{L}\p{M}' -]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || 'this person';
}

/** Fixed detail sentences. Only `displayName` output is ever interpolated. */
export const STEP_DETAILS = {
  hunterFinderFound: 'Hunter found an email address for this person.',
  hunterFinderNone: 'Hunter could not find an email address for this person.',
  domainFound: (last: string) => `Hunter's list for the company includes ${displayName(last)}.`,
  domainNone: (last: string) => `Hunter searched the domain and found no one called ${displayName(last)}.`,
  domainAmbiguous: (last: string) => `Hunter lists more than one person called ${displayName(last)}, so none was picked.`,
  patternVerified: 'Built an address from the company email pattern and Hunter verified it.',
  patternGuess: 'Built an address from the company email pattern, but it could not be verified. It is offered below as a guess.',
  patternInvalid: 'Built an address from the company email pattern, but Hunter says it does not exist.',
  patternNone: 'Hunter does not know this company\'s email pattern, or the name cannot be turned into an address.',
  websiteFound: 'Found details for this person on the company website.',
  websiteNone: 'Read the company website but found no details for this person.',
  websiteUnreadable: 'The company website could not be read.',
  webFound: 'A web search found possible details. Check them before using them.',
  webNone: 'A web search found nothing reliable for this person.',
  webFailed: 'The web search did not work this time.',
  apolloFound: 'Apollo found details for this person.',
  apolloNone: 'Apollo found no match for this person.',
  apolloUnavailable: 'Apollo is not available on this plan, so it was skipped.',
  apolloKeyRejected: 'Apollo did not accept the saved key, so it was skipped.',
  noKeyHunter: 'No Hunter key is saved for this organisation.',
  noKeyApollo: 'No Apollo key is saved for this organisation.',
  noKeyGemini: 'No Gemini key is saved for this organisation.',
  noWebsite: 'This lead has no usable website.',
  directory: 'The lead\'s website is a social or directory page, so it was not searched.',
  paidOff: 'Paid lookups were switched off for this search.',
  needName: 'A first and last name are needed for this step.',
  alreadyFilled: 'Not needed: the details were already found.',
  noPattern: 'Not run: Hunter did not give a company email pattern.',
  timeUp: 'Skipped to keep the lookup quick.',
  limit: 'Skipped: the daily lookup limit for this lead has been reached.',
  failed: 'This step did not work this time.',
} as const;

/** Name key: diacritics removed, lowercase, trimmed, whitespace collapsed. */
function nameKey(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Name key for comparing surnames: like nameKey, and spaces, hyphens, apostrophes and dots removed. */
function compactName(value: string | null | undefined): string {
  return nameKey(value).replace(/[\s'’.-]/g, '');
}

/** Small table of common first-name variants. Two names agree when one group contains both. */
const NICKNAME_GROUPS: string[][] = [
  ['john', 'jon', 'jonathan', 'johnny', 'jonny'],
  ['william', 'will', 'bill', 'billy', 'liam'],
  ['robert', 'rob', 'bob', 'bobby', 'robbie'],
  ['richard', 'rich', 'rick', 'richie'],
  ['michael', 'mike', 'mick', 'mikey'],
  ['james', 'jim', 'jimmy', 'jamie'],
  ['thomas', 'tom', 'tommy'],
  ['christopher', 'chris'],
  ['nicholas', 'nick', 'nicky'],
  ['daniel', 'dan', 'danny'],
  ['matthew', 'matt'],
  ['andrew', 'andy', 'drew'],
  ['anthony', 'tony'],
  ['joseph', 'joe', 'joey'],
  ['david', 'dave', 'davey'],
  ['stephen', 'steven', 'steve'],
  ['alexander', 'alex'],
  ['katherine', 'catherine', 'kate', 'katie', 'kathryn', 'cathy'],
  ['elizabeth', 'liz', 'lizzie', 'beth', 'betty'],
  ['margaret', 'maggie', 'meg'],
  ['rebecca', 'becky', 'becca'],
  ['benjamin', 'ben'],
  ['edward', 'ed', 'eddie', 'ted'],
  ['peter', 'pete'],
  ['jennifer', 'jen', 'jenny'],
  ['victoria', 'vicky', 'tori'],
  ['maxwell', 'max'],
  ['maximilian', 'max'],
  ['samuel', 'sam'],
  ['samantha', 'sam'],
];

/** True when two first names agree: the same, a known nickname pair, or one side is only an initial that matches. */
export function firstNamesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = compactName(a);
  const y = compactName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length === 1 || y.length === 1) return x[0] === y[0];
  return NICKNAME_GROUPS.some((g) => g.includes(x) && g.includes(y));
}

const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Lowercased, trimmed email when it is a plausible address, else null. */
export function cleanEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const e = value.trim().toLowerCase().replace(/\.+$/, '');
  if (e.length > 254 || !EMAIL_RE.test(e)) return null;
  const [local, domain] = e.split('@') as [string, string];
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..') || domain.includes('..')) return null;
  return e;
}

/** True when an email sits exactly on the given domain (no subdomains, no lookalikes). */
export function onDomain(email: string, domain: string): boolean {
  return email.slice(email.lastIndexOf('@') + 1) === domain.trim().toLowerCase();
}

/**
 * A personal LinkedIn profile link in one fixed shape, https://www.linkedin.com/in/<slug>, or null.
 * Query strings and fragments are dropped. Company pages, posts and other hosts are refused.
 */
export function cleanLinkedinProfile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(?:https?:\/\/)?(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]{3,100})\/?(?:[?#]\S*)?$/i.exec(value.trim());
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

/**
 * First-name agreement for a Hunter entry. A full first name must agree (same name or nickname pair). An
 * initial-only name must share the typed first initial. A missing first name agrees only when the address itself
 * starts with the typed first name, or is the first initial plus the surname (either order), so a surname-only
 * entry never matches on its own.
 */
function hunterFirstAgrees(hunterFirst: string, typedFirst: string, email: string, lastKey: string): boolean {
  const h = compactName(hunterFirst);
  const t = compactName(typedFirst);
  if (h.length > 1) return firstNamesAgree(t, h);
  if (h.length === 1) return h === t[0];
  const flat = email.slice(0, email.indexOf('@')).replace(/[._-]/g, '');
  const tf = emailNamePart(typedFirst);
  if (!tf) return false;
  return (tf.length > 1 && flat.startsWith(tf)) || flat === `${tf[0]}${lastKey}` || flat === `${lastKey}${tf[0]}`;
}

/** Hunter domain-search result for one person. */
export type HunterMatch =
  | { status: 'match'; email: string; linkedin_url: string | null }
  | { status: 'none' }
  | { status: 'ambiguous' };

/**
 * Picks the typed person out of Hunter's domain list (`data.emails[]`). Requires an exact surname match (accents,
 * spaces and hyphens ignored) AND an agreeing first name: the same name, a known nickname, or a missing/initial-only
 * first name on either side with the same initial. Entries with no surname are never used. When two different
 * addresses match, nothing is picked. Every field is checked for type, so an odd response just matches no one.
 */
export function matchHunterPerson(emails: unknown, first: string, last: string): HunterMatch {
  if (!Array.isArray(emails)) return { status: 'none' };
  const lastKey = compactName(last);
  if (!lastKey || !compactName(first)) return { status: 'none' };
  const hits = new Map<string, string | null>();
  for (const raw of emails) {
    if (typeof raw !== 'object' || raw === null) continue;
    const e = raw as Record<string, unknown>;
    const email = cleanEmail(e.value);
    if (!email) continue;
    const hl = typeof e.last_name === 'string' ? e.last_name : '';
    const hf = typeof e.first_name === 'string' ? e.first_name : '';
    if (compactName(hl) !== lastKey) continue;
    if (!hunterFirstAgrees(hf, first, email, lastKey)) continue;
    const linkedin = cleanLinkedinProfile(e.linkedin);
    hits.set(email, hits.get(email) ?? linkedin);
  }
  if (hits.size === 0) return { status: 'none' };
  if (hits.size > 1) return { status: 'ambiguous' };
  const [email, linkedin] = [...hits.entries()][0]!;
  return { status: 'match', email, linkedin_url: linkedin ?? null };
}

/** A name part usable in an email address: letters and digits only, or null when the name has other scripts. */
function emailNamePart(value: string): string | null {
  const t = nameKey(value).replace(/[\s'’.-]/g, '');
  return /^[a-z0-9]+$/.test(t) ? t : null;
}

/**
 * Builds an address from Hunter's company pattern (for example `{first}.{last}`). Known tokens: {first}, {last},
 * {f}, {l}; literal characters may only be `.`, `_` or `-`. Any other token or character, a name that cannot be
 * written in plain letters, or a result that is not a valid address gives null.
 */
export function buildPatternEmail(pattern: unknown, first: string, last: string, domain: string): string | null {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 40) return null;
  const f = emailNamePart(first);
  const l = emailNamePart(last);
  if (!f || !l) return null;
  const tokens: Record<string, string> = { first: f, last: l, f: f[0]!, l: l[0]! };
  let local = '';
  let usedToken = false;
  for (const m of pattern.matchAll(/\{([a-z]+)\}|([^{}])/g)) {
    if (m[1] !== undefined) {
      const v = tokens[m[1]];
      if (v === undefined) return null;
      local += v;
      usedToken = true;
    } else if (m[2] !== undefined && /^[._-]$/.test(m[2])) {
      local += m[2];
    } else {
      return null;
    }
  }
  if (!usedToken || pattern.replace(/\{[a-z]+\}|[._-]/g, '') !== '') return null;
  const email = cleanEmail(`${local}@${domain}`);
  return email && onDomain(email, domain) ? email : null;
}

/** How a Hunter email-verifier status is treated. */
export type VerifierClass = 'verified' | 'invalid' | 'unverified';

/** valid/deliverable count as verified, invalid/undeliverable as invalid, anything else (or nothing) as unverified. */
export function classifyVerifierStatus(status: unknown): VerifierClass {
  const s = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (s === 'valid' || s === 'deliverable') return 'verified';
  if (s === 'invalid' || s === 'undeliverable') return 'invalid';
  return 'unverified';
}

const GENERIC_LOCAL = new Set([
  'info', 'hello', 'hi', 'contact', 'contactus', 'enquiries', 'enquiry', 'sales', 'admin', 'office', 'support', 'help',
  'mail', 'email', 'team', 'accounts', 'accounting', 'finance', 'reception', 'bookings', 'booking', 'jobs', 'careers',
  'hr', 'marketing', 'press', 'media', 'noreply', 'no-reply', 'webmaster', 'privacy', 'gdpr', 'billing', 'orders', 'service',
]);

/** True when the address is a shared mailbox (info@, sales@ and so on) rather than a person's. */
export function isGenericMailbox(email: string): boolean {
  return GENERIC_LOCAL.has(email.slice(0, email.indexOf('@')));
}

/**
 * True when an address's local part names the person: it contains the surname, or it is the first name alone
 * or the first name plus the surname's initial. A first name alone inside a longer local part is not enough.
 */
export function localPartNamesPerson(email: string, first: string, last: string): boolean {
  const local = email.slice(0, email.indexOf('@'));
  const flat = local.replace(/[._-]/g, '');
  const f = emailNamePart(first);
  const l = emailNamePart(last);
  if (l && l.length >= 2 && flat.includes(l)) return true;
  if (f && f.length >= 2 && (flat === f || flat === `${f}${l?.[0] ?? ''}` || flat === `${l?.[0] ?? ''}${f}`)) return true;
  return false;
}

const BLOCK_RADIUS = 400;
const MAILTO_RE = /mailto:([^"'\s<>]+)/gi;
const PLAIN_EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const LINKEDIN_RE = /(?:https?:)?\/\/(?:[a-z]{2,3}\.|www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]{3,100}/gi;

/** Same-domain, non-generic addresses in a stretch of HTML (mailto links, query strings dropped, and plain text). */
function emailsIn(html: string, domain: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(MAILTO_RE)) {
    let target = m[1]!.split('?')[0]!;
    try { target = decodeURIComponent(target); } catch { continue; }
    const e = cleanEmail(target);
    if (e && onDomain(e, domain) && !isGenericMailbox(e)) out.add(e);
  }
  for (const m of html.matchAll(PLAIN_EMAIL_RE)) {
    const e = cleanEmail(m[0]);
    if (e && onDomain(e, domain) && !isGenericMailbox(e)) out.add(e);
  }
  return [...out];
}

function linkedinsIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(LINKEDIN_RE)) {
    const v = cleanLinkedinProfile(m[0].replace(/^\/\//, 'https://'));
    if (v) out.add(v);
  }
  return [...out];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** What one page says about the person. Lists hold distinct candidates; the caller decides when one is clear. */
export interface WebsiteFindings { emails: string[]; linkedin_urls: string[] }

/**
 * Reads one HTML page for the person: (1) any address on the company's domain whose local part names them, and
 * (2) within about 400 characters of their full name, a same-domain address and a linkedin.com/in link.
 * Obfuscated addresses ("name [at] domain") are ignored, other domains' addresses are ignored, and shared
 * mailboxes such as info@ are never taken. The page is data only; nothing in it is followed or obeyed.
 */
export function extractWebsiteFindings(html: string, domain: string, first: string, last: string): WebsiteFindings {
  const d = domain.trim().toLowerCase();
  if (!d || typeof html !== 'string' || !first.trim() || !last.trim()) return { emails: [], linkedin_urls: [] };
  const named = emailsIn(html, d).filter((e) => localPartNamesPerson(e, first, last));
  const nearEmails = new Set<string>();
  const nearLinks = new Set<string>();
  const gap = '(?:\\s|&nbsp;|&#160;)+';
  const parts = [first, last].map((p) => p.trim().split(/\s+/).map(escapeRegex).join(gap));
  const nameRe = new RegExp(`${parts[0]}${gap}${parts[1]}`, 'gi');
  let count = 0;
  for (const m of html.matchAll(nameRe)) {
    if (++count > 20) break;
    const start = Math.max(0, m.index! - BLOCK_RADIUS);
    const block = html.slice(start, m.index! + m[0].length + BLOCK_RADIUS);
    for (const e of emailsIn(block, d)) nearEmails.add(e);
    for (const l of linkedinsIn(block)) nearLinks.add(l);
  }
  const emails = [...new Set([...named, ...nearEmails])];
  return { emails, linkedin_urls: [...nearLinks] };
}

/**
 * Turns findings from several pages into at most one email and one LinkedIn link. An address that names the
 * person wins over one that only sat near their name; when two different candidates remain, none is used.
 */
export function pickWebsiteFindings(
  pages: WebsiteFindings[], first: string, last: string,
): { email: string | null; linkedin_url: string | null } {
  const emails = [...new Set(pages.flatMap((p) => p.emails))];
  const links = [...new Set(pages.flatMap((p) => p.linkedin_urls))];
  const naming = emails.filter((e) => localPartNamesPerson(e, first, last));
  const pool = naming.length > 0 ? naming : emails;
  return { email: pool.length === 1 ? pool[0]! : null, linkedin_url: links.length === 1 ? links[0]! : null };
}

const PERSON_PATHS = ['/team', '/about', '/contact', '/our-team', '/about-us', '/people', '/leadership', '/contact-us'];
const PERSON_PATH_RE = /^\/(?:[a-z-]+\/)?(team|our-team|meet-the-team|about|about-us|people|leadership|staff|contact|contact-us|who-we-are)\/?$/i;

/**
 * Up to `max` extra pages to read for a person: same-origin links from the home page that look like team/about/
 * contact pages first, then the usual paths. Other origins, non-http links and duplicates are dropped.
 */
export function pickPersonPages(homeUrl: string, hrefs: string[], max = 5): string[] {
  let base: URL;
  try { base = new URL(homeUrl); } catch { return []; }
  const seen = new Set<string>([base.pathname.replace(/\/+$/, '') || '/']);
  const out: string[] = [];
  const add = (u: URL) => {
    const key = u.pathname.replace(/\/+$/, '') || '/';
    if (out.length >= max || seen.has(key)) return;
    seen.add(key);
    out.push(`${u.origin}${key}`);
  };
  for (const href of hrefs.slice(0, 500)) {
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.origin !== base.origin) continue;
    if (PERSON_PATH_RE.test(u.pathname)) add(u);
  }
  for (const p of PERSON_PATHS) add(new URL(p, base));
  return out;
}

/**
 * Strictly reads the web-search answer. Only a JSON object `{"email": ..., "linkedin_url": ...}` in the text counts.
 * An email is kept only when it is on the company's domain, names the person, is not a shared mailbox, and also
 * appears in the answer's prose outside the JSON. A LinkedIn link is kept only in the fixed profile shape and when
 * its profile path also appears in the prose. Anything else in the answer is ignored.
 */
export function parseWebFindings(
  text: unknown, domain: string, first: string, last: string,
): { email: string | null; linkedin_url: string | null } {
  const none = { email: null, linkedin_url: null };
  if (typeof text !== 'string' || text.length > 20_000) return none;
  const open = text.indexOf('{');
  const close = text.lastIndexOf('}');
  if (open < 0 || close <= open) return none;
  let obj: unknown;
  try { obj = JSON.parse(text.slice(open, close + 1)); } catch { return none; }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return none;
  const o = obj as Record<string, unknown>;
  const prose = `${text.slice(0, open)} ${text.slice(close + 1)}`.toLowerCase();
  const d = domain.trim().toLowerCase();
  let email = cleanEmail(o.email);
  if (email && !(onDomain(email, d) && !isGenericMailbox(email) && localPartNamesPerson(email, first, last) && prose.includes(email))) {
    email = null;
  }
  let linkedin = cleanLinkedinProfile(o.linkedin_url);
  if (linkedin && !prose.includes(linkedin.slice('https://www.'.length).toLowerCase())) linkedin = null;
  return { email, linkedin_url: linkedin };
}
