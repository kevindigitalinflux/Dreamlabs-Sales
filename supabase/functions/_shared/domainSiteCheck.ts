// supabase/functions/_shared/domainSiteCheck.ts
// Free corroboration of a discovered domain from its OWN website: does the site name the company or a person known
// to work there? Imports only import-free modules (tested from src/lib). Page text is data only: nothing in it is
// followed or obeyed, and only fixed sentences leave this module.
import { coreWords } from './nameVariants.ts';
import type { KnownPersonName } from './domainDiscovery.ts';

/** Why a site confirmed its domain, for the step line. */
export type SiteConfirmation = { confirms: true; why: 'name' | 'person'; match: string } | { confirms: false };

/**
 * Visible page text as lowercase words: scripts, styles and tags removed, and every email address, URL and hostname
 * removed FIRST so a domain never confirms itself (loveliving.uk on its own page must not count as "Love Living").
 */
export function pageWords(html: unknown): string[] {
  if (typeof html !== 'string') return [];
  return html.slice(0, 600_000)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/[^\s]+@[^\s]+/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\b/g, ' ')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when `phrase` (words) appears as consecutive whole words in `text`. */
function hasPhrase(text: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= text.length; i++) {
    if (phrase.every((w, j) => text[i + j] === w)) return true;
  }
  return false;
}

/**
 * Confirms a domain when its own pages carry, as whole words: the company's core name ("love living", at least two
 * core words, "and" optional), its one-word form when at least 6 letters ("loveliving"), or a known person's full
 * name ("max whatley"). A surname on its own never confirms (too many shared surnames). `names` should include the
 * business name, the registered name and their variants.
 */
export function siteConfirmsCompany(pages: string[], names: string[], people: KnownPersonName[]): SiteConfirmation {
  const text = pages.slice(0, 8).flatMap((p) => pageWords(p));
  if (text.length === 0) return { confirms: false };
  for (const n of names) {
    const core = coreWords(n);
    const plain = core.filter((w) => w !== 'and');
    if (plain.length >= 2 && (hasPhrase(text, core) || hasPhrase(text, plain))) return { confirms: true, why: 'name', match: plain.join(' ') };
    const compact = plain.join('');
    if (compact.length >= 6 && text.includes(compact)) return { confirms: true, why: 'name', match: compact };
  }
  for (const p of people.slice(0, 20)) {
    const first = coreWordsOfPerson(p.first);
    const last = coreWordsOfPerson(p.last);
    if (first.length && last.length && hasPhrase(text, [...first, ...last])) return { confirms: true, why: 'person', match: `${first.join(' ')} ${last.join(' ')}` };
  }
  return { confirms: false };
}

function coreWordsOfPerson(v: string): string[] {
  return v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).slice(0, 3);
}

/** Every address on `domain` written literally on the pages (lowercase, deduplicated, at most 20). */
export function domainEmailsOnPages(pages: string[], domain: string): string[] {
  const d = domain.toLowerCase();
  const out: string[] = [];
  const re = /(?:mailto:)?([a-z0-9._%+-]{1,64})@([a-z0-9.-]{1,253})/gi;
  for (const p of pages.slice(0, 8)) {
    if (typeof p !== 'string') continue;
    for (const m of p.slice(0, 600_000).matchAll(re)) {
      const host = m[2]!.toLowerCase().replace(/\.+$/, '');
      if (host !== d) continue;
      const email = `${m[1]!.toLowerCase()}@${host}`;
      if (!out.includes(email) && out.length < 20) out.push(email);
    }
  }
  return out;
}

/** The fixed step line for a site that confirmed its domain. */
export function siteConfirmLine(domain: string, c: SiteConfirmation): string | null {
  if (!c.confirms) return null;
  const d = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
  const m = c.match.replace(/[^a-z0-9 ]/g, '').slice(0, 60);
  return c.why === 'name'
    ? `Domain ${d}: its own website names the company ("${m}"), so it is confirmed.`
    : `Domain ${d}: its own website names ${m}, a person known at the company, so it is confirmed.`;
}
