// Email formatting: a tiny marker syntax kept inside plain-string bodies.
//   **bold**, "- " bullet lines, "## " heading lines, [text](https://url) links
//   (bare http(s) URLs are also made clickable). Everything else is literal.
// One parser feeds three outputs: the HTML email, its plain-text copy, and the
// browser preview. Import-free so the browser tests can load it directly.

/** One inline piece of text inside a line. */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string };

/** One block of an email body. */
export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'heading'; inline: Inline[] }
  | { kind: 'list'; items: Inline[][] };

const LINK_HOST_RE = /^https?:\/\/[^\s/?#@]+\.[^\s/?#@]+/i;
const BARE_URL_START_RE = /^https?:\/\//i;
const BARE_URL_TRAILING_RE = /[.,;:!?)]+$/;

/**
 * True when `url` is an http(s) URL with a dotted host, no credentials and no
 * whitespace. Anything else must never become a clickable link.
 */
export function isSafeLinkUrl(url: string): boolean {
  return LINK_HOST_RE.test(url) && !/[\s\u0000-\u001f\u007f]/.test(url);
}

function pushText(out: Inline[], text: string): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.kind === 'text') last.text += text;
  else out.push({ kind: 'text', text });
}

/** Parses one line's inline markers. `onMarkup` is called for each bold or [text](url) found. */
function parseInline(src: string, onMarkup?: () => void): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('**', i)) {
      const close = src.indexOf('**', i + 2);
      if (close !== -1) {
        const inner = src.slice(i + 2, close);
        if (inner.trim() !== '') {
          out.push({ kind: 'bold', text: inner });
          onMarkup?.();
          i = close + 2;
          continue;
        }
      }
      pushText(out, '**');
      i += 2;
      continue;
    }
    if (src[i] === '[') {
      const mid = src.indexOf('](', i + 1);
      if (mid !== -1) {
        const text = src.slice(i + 1, mid);
        const end = src.indexOf(')', mid + 2);
        if (text.trim() !== '' && !text.includes('[') && end !== -1) {
          const href = src.slice(mid + 2, end);
          if (isSafeLinkUrl(href)) {
            out.push({ kind: 'link', text, href });
            onMarkup?.();
            i = end + 1;
            continue;
          }
        }
      }
      pushText(out, '[');
      i += 1;
      continue;
    }
    const prev = i > 0 ? src[i - 1] : '';
    if ((src[i] === 'h' || src[i] === 'H') && !/[A-Za-z0-9]/.test(prev) && BARE_URL_START_RE.test(src.slice(i, i + 8))) {
      const m = /^[^\s<>"]+/.exec(src.slice(i));
      const raw = m ? m[0] : '';
      const url = raw.replace(BARE_URL_TRAILING_RE, '');
      if (isSafeLinkUrl(url)) {
        out.push({ kind: 'link', text: url, href: url });
        i += url.length;
        continue;
      }
    }
    pushText(out, src[i]);
    i += 1;
  }
  return out;
}

function headingContent(line: string): string | null {
  if (!line.startsWith('## ')) return null;
  const c = line.slice(3).trim();
  return c === '' ? null : c;
}

function bulletContent(line: string): string | null {
  if (!line.startsWith('- ')) return null;
  const c = line.slice(2).trim();
  return c === '' ? null : c;
}

function parseBlocks(body: string, onMarkup?: () => void): Block[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let current: Block | null = null;
  for (const line of lines) {
    if (line.trim() === '') {
      current = null;
      continue;
    }
    const heading = headingContent(line);
    if (heading !== null) {
      onMarkup?.();
      blocks.push({ kind: 'heading', inline: parseInline(heading, onMarkup) });
      current = null;
      continue;
    }
    const bullet = bulletContent(line);
    if (bullet !== null) {
      onMarkup?.();
      if (!current || current.kind !== 'list') {
        current = { kind: 'list', items: [] };
        blocks.push(current);
      }
      current.items.push(parseInline(bullet, onMarkup));
      continue;
    }
    if (!current || current.kind !== 'paragraph') {
      current = { kind: 'paragraph', lines: [] };
      blocks.push(current);
    }
    current.lines.push(parseInline(line, onMarkup));
  }
  return blocks;
}

/** Parses an email body written in the marker syntax into blocks. Never drops text. */
export function parseEmail(body: string): Block[] {
  return parseBlocks(body);
}

/**
 * True if the body uses any marker: bold, a bullet, a heading or a [text](url)
 * link. A bare URL on its own does not count (plain emails stay plain).
 */
export function hasFormatting(body: string): boolean {
  let found = false;
  parseBlocks(body, () => {
    found = true;
  });
  return found;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineHtml(pieces: Inline[]): string {
  return pieces
    .map((p) => {
      if (p.kind === 'bold') return `<strong>${escapeHtml(p.text)}</strong>`;
      if (p.kind === 'link') {
        return `<a href="${escapeHtml(p.href)}" style="color:#2563eb" rel="noopener noreferrer">${escapeHtml(p.text)}</a>`;
      }
      return escapeHtml(p.text);
    })
    .join('');
}

const FONT_STYLE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2937";

/** Renders the body as a safe, inline-styled HTML fragment for the HTML part of an email. */
export function renderEmailHtml(body: string): string {
  const inner = parseEmail(body)
    .map((block) => {
      if (block.kind === 'heading') {
        return `<p style="margin:16px 0 8px;font-size:17px;font-weight:700">${inlineHtml(block.inline)}</p>`;
      }
      if (block.kind === 'list') {
        const items = block.items.map((item) => `<li style="margin:0 0 4px">${inlineHtml(item)}</li>`).join('');
        return `<ul style="margin:0 0 12px;padding-left:22px">${items}</ul>`;
      }
      return `<p style="margin:0 0 12px">${block.lines.map(inlineHtml).join('<br>')}</p>`;
    })
    .join('');
  return `<div style="${FONT_STYLE}">${inner}</div>`;
}

function inlineText(pieces: Inline[]): string {
  return pieces
    .map((p) => {
      if (p.kind === 'link') return p.text === p.href ? p.href : `${p.text} (${p.href})`;
      return p.text;
    })
    .join('');
}

/**
 * Renders the plain-text alternative: bold markers removed, bullets as "- ",
 * headings as their plain line, links as "text (url)" (or just the url).
 */
export function renderEmailText(body: string): string {
  return parseEmail(body)
    .map((block) => {
      if (block.kind === 'heading') return inlineText(block.inline);
      if (block.kind === 'list') return block.items.map((item) => `- ${inlineText(item)}`).join('\n');
      return block.lines.map(inlineText).join('\n');
    })
    .join('\n\n');
}

/**
 * What to hand the mailer for a body. No markers: exactly the body, plain text
 * only (unchanged from before formatting existed). With markers: a plain-text
 * copy plus the HTML version, sent together as multipart/alternative.
 */
export function buildMailContent(body: string): { content: string; html?: string } {
  if (!hasFormatting(body)) return { content: body };
  return { content: renderEmailText(body), html: renderEmailHtml(body) };
}
