// supabase/functions/_shared/researchPages.ts
// Pure helpers for lead research. No imports, so they can be unit tested from src/lib.

const RESEARCH_PATH = /about|team|service|product|news|blog|contact|people|who-we-are/i;

function normalisedKey(url: URL): string {
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
}

/**
 * Picks up to `max` same-origin links worth reading for research (about, team, services,
 * news and so on). Resolves relative hrefs against `baseUrl`, drops other origins,
 * non-http schemes, the homepage and duplicates (ignoring fragments and trailing slashes).
 */
export function pickResearchLinks(baseUrl: string, hrefs: string[], max = 4): string[] {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return []; }
  const seen = new Set<string>([normalisedKey(base)]);
  const out: string[] = [];
  for (const href of hrefs) {
    if (out.length >= max) break;
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.origin !== base.origin) continue;
    if (!RESEARCH_PATH.test(url.pathname)) continue;
    url.hash = '';
    const key = normalisedKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.toString());
  }
  return out;
}

/** Plain text from HTML: drops script/style/noscript/svg, strips tags, collapses whitespace, caps length. */
export function stripToText(html: string, maxChars = 6000): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/** Joins the research sections into one note. Empty sections are left out; nothing at all gives ''. */
export function formatResearchNote(parts: { website: string | null; web: string | null; sources: string[] }): string {
  const blocks: string[] = [];
  if (parts.website && parts.website.trim()) blocks.push(`From their website:\n${parts.website.trim()}`);
  if (parts.web && parts.web.trim()) blocks.push(`From the web:\n${parts.web.trim()}`);
  if (blocks.length > 0 && parts.sources.length > 0) {
    blocks.push(`Sources:\n${parts.sources.map((s) => `- ${s}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}
