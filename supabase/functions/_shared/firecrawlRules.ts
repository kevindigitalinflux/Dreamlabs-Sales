// Pure policy and untrusted-output parsing; no Deno, database or provider SDK.
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { DOMAIN_CHECKS } from './domainChecks.ts';
import { domainFromWebsite } from './knownPerson.ts';
import { extractTeamMembers, type SitePerson } from './deepFindRules.ts';
import { domainEmailsOnPages } from './domainSiteCheck.ts';

export const FIRECRAWL_DAILY_PAGES = 100;
export const FIRECRAWL_MAX_BYTES = 600_000;
export const FIRECRAWL_NOT_CONFIGURED = 'Firecrawl is not set up for this organisation.';
const TEAM_PATHS = ['team', 'our-team', 'people', 'leadership', 'about', 'about-us'];

export function firecrawlDomainFor(confirmed: string[], hasNamedRoles: boolean): string | null {
  if (hasNamedRoles) return null;
  return confirmed.find((domain) => DOMAIN_CHECKS.clean(domain) === domain && DOMAIN_CHECKS.usable(domain)) ?? null;
}

export function firecrawlTimeoutFor(leftMs: number): number | null {
  const timeout = Math.min(12_000, leftMs - 32_000);
  return timeout >= 5000 ? timeout : null;
}

/** The caller supplies a confirmed domain, never an arbitrary URL. Only links actually seen on that domain qualify. */
export function chooseFirecrawlPage(domain: string, pages: string[], excluded: string[] = []): string | null {
  if (DOMAIN_CHECKS.clean(domain) !== domain || !DOMAIN_CHECKS.usable(domain)) return null;
  const home = `https://${domain}/`;
  const found: Array<{ url: string; rank: number }> = [];
  for (const page of pages.slice(0, 8)) {
    for (const match of page.slice(0, 600_000).matchAll(/\bhref\s*=\s*["']([^"']{1,2048})["']/gi)) {
      let url: URL;
      try { url = new URL(match[1]!, home); } catch { continue; }
      if (!parseSafeWebsiteUrl(url.href) || url.protocol !== 'https:' || url.port || domainFromWebsite(url.href) !== domain) continue;
      const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
      const rank = TEAM_PATHS.indexOf(segments.at(-1) ?? '');
      if (rank < 0 || segments.length > 3) continue;
      url.search = ''; url.hash = '';
      found.push({ url: url.href, rank });
      if (found.length >= 40) break;
    }
  }
  return found.filter(p => !excluded.includes(p.url)).sort((a, b) => a.rank - b.rank)[0]?.url ?? (excluded.includes(home) ? null : home);
}

export interface FirecrawlTeam { people: SitePerson[]; emails: string[] }
export function parseFirecrawlReply(raw: unknown, domain: string): FirecrawlTeam | null {
  if (!chooseFirecrawlPage(domain, []) || !raw || typeof raw !== 'object') return null;
  const value = raw as { success?: unknown; data?: { rawHtml?: unknown; html?: unknown; metadata?: { sourceURL?: unknown; url?: unknown; statusCode?: unknown } } };
  if (value.success !== true || !value.data || typeof value.data !== 'object') return null;
  const { metadata } = value.data;
  if (metadata?.statusCode && (typeof metadata.statusCode !== 'number' || metadata.statusCode < 200 || metadata.statusCode >= 300)) return null;
  for (const address of [metadata?.sourceURL, metadata?.url]) {
    if (address !== undefined && (typeof address !== 'string' || !parseSafeWebsiteUrl(address) || domainFromWebsite(address) !== domain)) return null;
  }
  const html = value.data.rawHtml ?? value.data.html;
  if (typeof html !== 'string' || html.length > FIRECRAWL_MAX_BYTES) return null;
  return { people: extractTeamMembers(html).slice(0, 10), emails: domainEmailsOnPages([html], domain).slice(0, 10) };
}
