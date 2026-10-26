import { parsePhoneNumberFromString, type CountryCode } from 'npm:libphonenumber-js@1.13.15/max';

export type PhoneKind = 'company_line' | 'direct' | 'mobile' | 'unknown';
export type PhoneSource = 'places' | 'own_site' | 'worker_scrape' | 'registry' | 'apollo' | 'manual' | 'other';
export interface PhoneMetadata { kind: PhoneKind; source: PhoneSource; source_url: string | null; found_at: string | null; original?: string; sole_trader?: boolean }
export interface BusinessPhone extends PhoneMetadata { value: string; original: string }
export interface PhonePage { html: string; url: string; source: 'own_site' | 'worker_scrape' }
export interface PersonPhoneSuggestion { name: string; field: 'person_phone'; value: string; label: string; phone: BusinessPhone }

/** The existing Phase 3 admission gate, preserved verbatim. Parsing never broadens automatic fills. */
export function isPlausiblePhone(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const raw = value.trim();
  if (/^\s*\d{1,2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{2,4}\s*$/.test(raw)) return false;
  if (!/^\+?[\d\s().-]+$/.test(raw) || /\d{4}-\d{2}-\d{2}|^\d{4}-\d{4}$/.test(raw)) return false;
  let digits = raw.replace(/\D/g, '');
  if (/^(\d)\1+$/.test(digits) || /(\d)\1{6}/.test(digits)) return false;
  if (raw.startsWith('+44')) {
    digits = digits.slice(2).replace(/^0/, '');
    return /^[12378]\d{9}$/.test(digits);
  }
  if (raw.startsWith('+353')) return /^[1-9]\d{7,9}$/.test(digits.slice(3).replace(/^0/, ''));
  if (raw.startsWith('+')) return /^[1-9]\d{7,14}$/.test(digits);
  return /^0[12378]\d{8,9}$/.test(digits) || /^0[1-9]\d{6,8}$/.test(digits);
}

/** Parse business phone text without extracting numbers from prose or guessing an unlisted country's prefix. */
export function parsePhone(input: unknown, country: unknown = 'GB'): { value: string; original: string; lineType: 'mobile' | 'landline' | 'unknown' } | null {
  if (typeof input !== 'string' || input.length > 80) return null;
  const original = input.trim();
  if (!/^\+?[\d\s().-]+$/.test(original) || /\d{4}-\d{2}-\d{2}|^\d{4}-\d{4}$/.test(original)
    || /^\d{1,2}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{2,4}$/.test(original)) return null;
  const digits = original.replace(/\D/g, '');
  if (/(\d)\1{6}/.test(digits)) return null;
  const defaultCountry = country == null ? 'GB' : ['GB', 'IE', 'US', 'AE', 'SA'].includes(String(country)) ? country as CountryCode : undefined;
  const raw = original.replace(/^00/, '+').replace(/^(\+44|\+353|\+971|\+966)\s*\(0\)/, '$1');
  if (!raw.startsWith('+') && !defaultCountry) return null;
  const parsed = parsePhoneNumberFromString(raw, { defaultCountry, extract: false });
  if (!parsed?.isPossible()) return null;
  // National GB/IE shapes retain the previous review safeguards, including fictional but possible test ranges.
  if ((parsed.country === 'GB' || parsed.country === 'IE') && !isPlausiblePhone(raw)) return null;
  if (raw.startsWith('+44') && !isPlausiblePhone(raw)) return null;
  const type = parsed.getType();
  return { value: parsed.number, original, lineType: type === 'MOBILE' ? 'mobile' : type === 'FIXED_LINE' ? 'landline' : 'unknown' };
}

/** Keep the caller's relationship label separate from the numbering plan's mobile/landline classification. */
export function phoneMetadata(input: unknown, country: unknown, kind: PhoneKind, source: PhoneSource, sourceUrl: string | null, foundAt: string | null): BusinessPhone | null {
  const parsed = parsePhone(input, country);
  return parsed ? { value: parsed.value, original: parsed.original, kind, source, source_url: safePhoneSourceUrl(sourceUrl), found_at: foundAt } : null;
}

/** Only web provenance links can leave the shared parser. */
export function safePhoneSourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

const words = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** Business sources only. Callers must also supply only pages from an already confirmed company domain. */
export function businessPhoneSource(url: string): boolean {
  const safe = safePhoneSourceUrl(url);
  if (!safe) return false;
  const host = new URL(safe).hostname.toLowerCase();
  return !['linkedin.com', 'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'tiktok.com', 'rocketreach.co', 'zoominfo.com', 'lusha.com', 'contactout.com', 'signalhire.com', 'apollo.io']
    .some(domain => host === domain || host.endsWith('.' + domain));
}

/** Extract phone candidates from one visible business block; script/style/footer numbers are excluded. */
export function phonesInBlock(html: string): string[] {
  const clean = html.replace(/<(script|style|svg|footer|header|nav)\b[\s\S]*?<\/\1>/gi, ' ');
  const tel = [...clean.matchAll(/\bhref\s*=\s*["']tel:([^"'?#]+)["']/gi)].map(m => m[1]!);
  const text = clean.replace(/<[^>]*>/g, '|');
  return [...tel, ...[...text.matchAll(/(?<![\w.@])(\+?\d[\d\s().-]{6,24}\d)(?![\w.@])/g)].map(m => m[1]!.trim())];
}

/** Suggest only: the smallest staff block must name this person and publish the phone beside them. No fetches. */
export function personPhoneSuggestion(name: string, pages: PhonePage[], companyPhone: unknown, country: unknown, foundAt: string,
  fallback?: PhoneMetadata): PersonPhoneSuggestion | null {
  const needle = words(name);
  if (!needle || needle.split(' ').length < 2) return null;
  for (const page of pages.slice(0, 24)) {
    if (!businessPhoneSource(page.url)) continue;
    const html = page.html.slice(0, 600_000).replace(/<(script|style|svg|footer|header|nav)\b[\s\S]*?<\/\1>/gi, ' ');
    const stack: { tag: string; start: number }[] = [];
    const blocks: string[] = [];
    for (const match of html.matchAll(/<\/?(article|li|div|section|tr|address|p)\b[^>]*>/gi)) {
      const tag = match[1]!.toLowerCase();
      if (!match[0].startsWith('</')) stack.push({ tag, start: match.index! + match[0].length });
      else {
        const open = stack.pop();
        if (open?.tag === tag) { const block = html.slice(open.start, match.index); if ((' ' + words(block) + ' ').includes(' ' + needle + ' ')) blocks.push(block); }
      }
    }
    const block = blocks.sort((a, b) => a.length - b.length)[0];
    if (!block || block.length > 8_000) continue;
    for (const raw of phonesInBlock(block)) {
      const phone = phoneMetadata(raw, country, 'direct', page.source, page.url, foundAt);
      if (phone) return { name, field: 'person_phone', value: phone.value, label: 'Direct line published beside this name on the company website. Review before adding.', phone };
    }
  }
  const phone = phoneMetadata(companyPhone, country, 'company_line', fallback?.source ?? 'manual', fallback?.source_url ?? null, fallback?.found_at ?? foundAt);
  return phone ? { name, field: 'person_phone', value: phone.value, label: 'Company line (switchboard). Ask for this person. Review before adding.', phone } : null;
}

/** Convert shared metadata to the four additive contact columns; never touches provider-owned columns. */
export function contactPhonePatch(phone: BusinessPhone) {
  return { phone: phone.value, phone_kind: phone.kind, phone_source: phone.source, phone_source_url: phone.source_url, phone_found_at: phone.found_at };
}

/** Validate evidence stored in result JSON before offering a phone for review. */
export function readPhoneEvidence(raw: unknown, value: unknown): BusinessPhone | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (!['company_line', 'direct', 'mobile', 'unknown'].includes(String(p.kind))
    || !['places', 'own_site', 'worker_scrape', 'registry', 'apollo', 'manual', 'other'].includes(String(p.source))
    || (p.source_url != null && !safePhoneSourceUrl(p.source_url))
    || (p.found_at != null && (typeof p.found_at !== 'string' || !Number.isFinite(Date.parse(p.found_at))))) return null;
  const phone = phoneMetadata(value, 'OTHER', p.kind as PhoneKind, p.source as PhoneSource,
    typeof p.source_url === 'string' ? p.source_url : null, typeof p.found_at === 'string' ? p.found_at : null);
  return phone && phone.value === value ? { ...phone, original: typeof p.original === 'string' ? p.original.slice(0, 80) : phone.original } : null;
}
