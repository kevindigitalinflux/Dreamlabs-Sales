import { INDUSTRY_WORDS, GENERIC_COMPANY_WORDS } from './companyNameWords.ts';
// supabase/functions/_shared/nameVariants.ts
// Company name variants for searching providers ("Love Living" -> "loveliving", "love-living", "loveliving london",
// "love living management" ...). No imports on purpose: tested from src/lib. Variants only widen SEARCHES; every
// domain or company found through one still needs the existing corroboration before it is saved or trusted.

/** Words dropped to get the core of a name (legal forms and generic business words). */
const DROP = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'inc', 'co', 'company', 'cic', 'the', 'group', 'management', 'services', 'service',
  'uk', 'london', 'holdings',
]);

/** Lowercase words: accents removed, "&" read as "and", split on anything not a letter or digit. */
function words(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value.slice(0, 200).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/** The core words of a company name (legal forms and generic words dropped; "and" kept only between words). */
export function coreWords(value: unknown): string[] {
  const w = words(value).filter((x) => !DROP.has(x));
  while (w[0] === 'and') w.shift();
  while (w[w.length - 1] === 'and') w.pop();
  return w;
}

/** The core of a name written as one word: "Love Living Ltd" and "LOVELIVING LIMITED" both give "loveliving". */
export function compactName(value: unknown): string {
  return coreWords(value).filter((x) => x !== 'and').join('');
}

/** True when two company names are the same once spacing, "&"/"and", legal forms and generic words are ignored. */
export function sameCompanyName(a: unknown, b: unknown): boolean {
  const x = compactName(a);
  return x.length >= 3 && x === compactName(b);
}

/** One searchable variant of a company name. */
export interface NameVariant { text: string; kind: 'original' | 'core' | 'compact' | 'hyphen' | 'and_swap' | 'suffix' }

/**
 * Up to `max` (default 8) distinct search variants, most useful first: the name as written, its core words, the core as
 * one word, hyphenated, with "&"/"and" swapped (or "and" dropped), then common suffix forms ("loveliving london",
 * "loveliving uk", "love living management", "love living ltd"). Registered name variants come after the trading
 * name's. Every variant is plain lowercase letters, digits, spaces, "&" and hyphens, at most 80 characters.
 */
export function companyNameVariants(names: string[], max = 8): NameVariant[] {
  const out: NameVariant[] = [];
  const add = (text: string, kind: NameVariant['kind']) => {
    const t = text.replace(/[^a-z0-9& -]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    if (t.length >= 3 && out.length < max && !out.some((v) => v.text === t)) out.push({ text: t, kind });
  };
  const cores = names.map((n) => coreWords(n)).filter((c) => c.length > 0);
  for (const n of names) add(n, 'original');
  for (const core of cores) {
    const plain = core.filter((x) => x !== 'and');
    add(core.join(' '), 'core');
    if (plain.length > 1) add(plain.join(''), 'compact');
    if (plain.length > 1) add(plain.join('-'), 'hyphen');
    if (core.includes('and')) { add(core.join(' ').replace(/\band\b/g, '&'), 'and_swap'); add(plain.join(' '), 'and_swap'); }
  }
  for (const core of cores) {
    const plain = core.filter((x) => x !== 'and');
    const compact = plain.join('');
    add(`${compact} london`, 'suffix');
    add(`${compact} uk`, 'suffix');
    add(`${plain.join(' ')} management`, 'suffix');
    add(`${plain.join(' ')} ltd`, 'suffix');
  }
  return out;
}

/** At most this many Companies House name searches per lead (free API, but keep it polite). */
export const MAX_REGISTRY_SEARCHES = 5;

/**
 * The names searched on Companies House: as written, as one word ('LOVELIVING'), with 'london' and 'management'
 * added ('LOVE LIVING LONDON'), then with '&'/'and' swapped. At most MAX_REGISTRY_SEARCHES, no repeats.
 */
export function registrySearchNames(name: string): string[] {
  const out: string[] = [];
  const add = (t: string | undefined) => {
    const v = (t ?? '').replace(/[^a-z0-9& -]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    if (v.length >= 3 && !out.includes(v) && out.length < MAX_REGISTRY_SEARCHES) out.push(v);
  };
  const brands = brandNameCandidates(name);
  if (brands.length > 1) for (const brand of brands.filter(v => v !== name)) add(brand);
  const variants = companyNameVariants([name]);
  const plain = coreWords(name).filter((w) => w !== 'and');
  add(variants.find((v) => v.kind === 'original')?.text);
  add(variants.find((v) => v.kind === 'compact')?.text);
  if (plain.length > 0) { add(`${plain.join(' ')} london`); add(`${plain.join(' ')} management`); }
  for (const v of variants.filter((x) => x.kind === 'and_swap')) add(v.text);
  return out;
}

/** Up to four brand candidates, specific brand first and original descriptor name last. */
export function brandNameCandidates(name: string): string[] {
  const original = name.replace(/\s+/g, ' ').trim().slice(0, 200);
  const out: string[] = [];
  const generic = (part: string) => {
    const tokens = words(part);
    return tokens.length === 1 && (GENERIC_COMPANY_WORDS.has(tokens[0]) || INDUSTRY_WORDS.has(tokens[0]));
  };
  const add = (part: string) => {
    const value = part.trim();
    if (value.length >= 3 && !generic(value) && !out.some(v => v.toLowerCase() === value.toLowerCase()) && out.length < 4) out.push(value);
  };
  const segments = original.split(/\s[-–—|]\s|:\s*/).map(v => v.trim()).filter(Boolean);
  let brand = segments[0] ?? '';
  if (generic(brand)) brand = [...segments].sort((a,b) => b.length-a.length).find(v => !generic(v)) ?? '';
  // A long marketing tail, or an explicit site/HQ suffix, is not part of the brand.
  const tail = brand.match(/\s+(?:(?:global|creative|advertising|digital|marketing)\s+){2,}.*(?:agency|office|hq)\b.*$|\s+(?:london hq|head office|official site|official website)$/i);
  if (tail?.index !== undefined) brand = brand.slice(0, tail.index);
  add(brand);
  add(brand.replace(/([a-z])([0-9])/gi, '$1 $2').replace(/([0-9])([a-z])/gi, '$1 $2'));
  add(brand.replace(/([a-z])\s+([0-9])/gi, '$1$2').replace(/([0-9])\s+([a-z])/gi, '$1$2'));
  add(original);
  return out;
}
