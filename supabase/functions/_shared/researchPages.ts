// supabase/functions/_shared/researchPages.ts
// Pure helpers for lead research. No imports, so they can be unit tested from src/lib.

const RESEARCH_PATH = /about|team|service|product|news|blog|contact|people|who-we-are/i;
const SKIP_EXT = /\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv|jpe?g|png|gif|webp|svg|ico|mp3|mp4|mov|avi|css|js|xml|json)$/i;

function normalisedKey(url: URL): string {
  // The query string is ignored: /about?x=1 and /about?x=2 are the same page for our purposes.
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Picks up to `max` same-origin links worth reading for research (about, team, services,
 * news and so on). Resolves relative hrefs against `baseUrl`, drops other origins,
 * non-http schemes, file downloads and assets, the homepage and duplicates (ignoring
 * fragments, query strings and trailing slashes).
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
    if (SKIP_EXT.test(url.pathname)) continue;
    url.hash = '';
    const key = normalisedKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url.toString());
  }
  return out;
}

const BLOCK_OPEN = /<(script|style|noscript|svg)(?=[\s/>])/iy;

/** Index just past the '>' that ends a tag starting at `start`, ignoring '>' inside quotes; -1 if never closed. */
function tagEnd(s: string, start: number): number {
  let quote = '';
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return -1;
}

/**
 * Plain text from HTML: drops script/style/noscript/svg blocks, comments and tags, decodes a few
 * entities, collapses whitespace, caps length. Single linear pass (no backtracking regexes), and an
 * unclosed script/style/comment/tag strips to the end of the input, so truncated pages cannot leak code.
 */
export function stripToText(html: string, maxChars = 6000): string {
  const out: string[] = [];
  const n = html.length;
  let i = 0;
  while (i < n) {
    const j = html.indexOf('<', i);
    if (j < 0) { out.push(html.slice(i)); break; }
    out.push(html.slice(i, j));
    if (html.startsWith('<!--', j)) {
      const k = html.indexOf('-->', j + 4);
      out.push(' ');
      i = k < 0 ? n : k + 3;
      continue;
    }
    BLOCK_OPEN.lastIndex = j;
    const open = BLOCK_OPEN.exec(html);
    if (open) {
      const closer = new RegExp(`</${open[1]}`, 'gi');
      closer.lastIndex = j + open[0].length;
      const c = closer.exec(html);
      out.push(' ');
      if (!c) { i = n; continue; }
      const end = html.indexOf('>', c.index);
      i = end < 0 ? n : end + 1;
      continue;
    }
    const next = html[j + 1] ?? '';
    if (/[a-zA-Z/!?]/.test(next)) {
      const end = tagEnd(html, j);
      out.push(' ');
      i = end < 0 ? n : end;
      continue;
    }
    out.push('<');
    i = j + 1;
  }
  return out.join('')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
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
