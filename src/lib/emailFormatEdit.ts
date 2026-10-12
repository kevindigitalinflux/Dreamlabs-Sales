// Text operations behind the email formatting toolbar. Pure: each takes the
// textarea's text and selection and returns new text plus the selection to
// restore. See supabase/functions/_shared/emailFormat.ts for the marker syntax.
import { isSafeLinkUrl } from '../../supabase/functions/_shared/emailFormat';

/** The new text and the selection to restore after a toolbar action. */
export interface EditResult {
  text: string;
  selStart: number;
  selEnd: number;
}

interface Edit {
  at: number;
  del: number;
  ins: string;
}

type Bias = 'before' | 'after';

/** Where position `p` lands after `edits`. 'after' moves past text inserted exactly at `p`. */
function mapPos(p: number, edits: Edit[], bias: Bias): number {
  let shift = 0;
  for (const ed of edits) {
    const end = ed.at + ed.del;
    if (p > ed.at && p < end) shift -= p - ed.at;
    else if (end < p || (end === p && (ed.del > 0 || bias === 'after'))) shift += ed.ins.length - ed.del;
  }
  return p + shift;
}

function applyEdits(text: string, edits: Edit[], s: number, e: number, startBias: Bias, endBias: Bias): EditResult {
  const sorted = [...edits].sort((a, b) => b.at - a.at);
  let out = text;
  for (const ed of sorted) out = out.slice(0, ed.at) + ed.ins + out.slice(ed.at + ed.del);
  return { text: out, selStart: mapPos(s, edits, startBias), selEnd: mapPos(e, edits, endBias) };
}

const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;

/** Ranges [start, end) of the selection's trimmed text on each line it covers. */
function lineSegments(text: string, s: number, e: number): [number, number][] {
  const segs: [number, number][] = [];
  let start = s;
  while (start <= e) {
    const nl = text.indexOf('\n', start);
    const lineEnd = nl === -1 || nl > e ? e : nl;
    let a = start;
    let b = lineEnd;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) segs.push([a, b]);
    if (nl === -1 || nl >= e) break;
    start = nl + 1;
  }
  return segs;
}

const wrappedOutside = (t: string, a: number, b: number) => a >= 2 && t.slice(a - 2, a) === '**' && t.slice(b, b + 2) === '**';
const wrappedInside = (t: string, a: number, b: number) => b - a > 4 && t.startsWith('**', a) && t.slice(b - 2, b) === '**';

/**
 * Toggles **bold** on the selection (each line separately). An empty selection
 * uses the word under the cursor, or inserts "****" with the cursor between.
 */
export function toggleBold(text: string, selStart: number, selEnd: number): EditResult {
  let s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  if (s === e) {
    let a = s;
    let b = s;
    while (a > 0 && WORD_CHAR.test(text[a - 1])) a--;
    while (b < text.length && WORD_CHAR.test(text[b])) b++;
    if (a === b) return { text: `${text.slice(0, s)}****${text.slice(s)}`, selStart: s + 2, selEnd: s + 2 };
    s = a;
    e = b;
  }
  const segs = lineSegments(text, s, e);
  if (segs.length === 0) return { text, selStart, selEnd };
  const edits: Edit[] = [];
  const allWrapped = segs.every(([a, b]) => wrappedOutside(text, a, b) || wrappedInside(text, a, b));
  for (const [a, b] of segs) {
    if (allWrapped) {
      if (wrappedOutside(text, a, b)) edits.push({ at: a - 2, del: 2, ins: '' }, { at: b, del: 2, ins: '' });
      else edits.push({ at: a, del: 2, ins: '' }, { at: b - 2, del: 2, ins: '' });
    } else if (!wrappedOutside(text, a, b) && !wrappedInside(text, a, b)) {
      edits.push({ at: a, del: 0, ins: '**' }, { at: b, del: 0, ins: '**' });
    }
  }
  const single = segs.length === 1;
  const from = single ? segs[0][0] : s;
  const to = single ? segs[0][1] : e;
  return applyEdits(text, edits, from, to, single ? 'after' : 'before', single ? 'before' : 'after');
}

/** Start offsets of every line the selection touches (a selection ending at a line start excludes that line). */
function touchedLineStarts(text: string, s: number, e: number): number[] {
  const last = e > s && text[e - 1] === '\n' ? e - 1 : e;
  const starts: number[] = [];
  let p = text.lastIndexOf('\n', s - 1) + 1;
  for (;;) {
    starts.push(p);
    const nl = text.indexOf('\n', p);
    if (nl === -1 || nl >= last) break;
    p = nl + 1;
  }
  return starts;
}

function lineAt(text: string, start: number): string {
  const nl = text.indexOf('\n', start);
  return text.slice(start, nl === -1 ? text.length : nl);
}

function linesFor(text: string, s: number, e: number): number[] {
  const starts = touchedLineStarts(text, s, e);
  if (starts.length === 1) return starts;
  return starts.filter((st) => lineAt(text, st).trim() !== '');
}

function togglePrefix(text: string, selStart: number, selEnd: number, prefix: string, other: string): EditResult {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const starts = linesFor(text, s, e);
  if (starts.length === 0) return { text, selStart, selEnd };
  const allHave = starts.every((st) => lineAt(text, st).startsWith(prefix));
  const edits: Edit[] = [];
  for (const st of starts) {
    const line = lineAt(text, st);
    if (allHave) edits.push({ at: st, del: prefix.length, ins: '' });
    else if (line.startsWith(other)) edits.push({ at: st, del: other.length, ins: prefix });
    else if (!line.startsWith(prefix)) edits.push({ at: st, del: 0, ins: prefix });
  }
  return applyEdits(text, edits, s, e, 'after', 'after');
}

/** Toggles "- " bullets on every non-empty line the selection touches. */
export function toggleBullets(text: string, selStart: number, selEnd: number): EditResult {
  return togglePrefix(text, selStart, selEnd, '- ', '## ');
}

/** Toggles a "## " heading on every non-empty line the selection touches. */
export function toggleHeading(text: string, selStart: number, selEnd: number): EditResult {
  return togglePrefix(text, selStart, selEnd, '## ', '- ');
}

/**
 * Wraps the selection as [selection](url). With no selection (or one that
 * cannot be link text: brackets or several lines) inserts [url](url) after it.
 */
export function insertLink(text: string, selStart: number, selEnd: number, url: string): EditResult {
  let s = Math.min(selStart, selEnd);
  let e = Math.max(selStart, selEnd);
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  const selected = text.slice(s, e);
  if (selected === '' || /[[\]\n]/.test(selected)) {
    const at = Math.max(selStart, selEnd);
    const link = `[${url}](${url})`;
    const out = text.slice(0, at) + link + text.slice(at);
    return { text: out, selStart: at + link.length, selEnd: at + link.length };
  }
  const out = `${text.slice(0, s)}[${selected}](${url})${text.slice(e)}`;
  return { text: out, selStart: s + 1, selEnd: e + 1 };
}

/** Ranges [open, closeEnd) of every **bold** span on the line starting at `lineStart`. */
function boldSpans(text: string, lineStart: number): [number, number][] {
  const line = lineAt(text, lineStart);
  const spans: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    if (line.startsWith('**', i)) {
      const close = line.indexOf('**', i + 2);
      if (close !== -1 && line.slice(i + 2, close).trim() !== '') {
        spans.push([lineStart + i, lineStart + close + 2]);
        i = close + 2;
        continue;
      }
      i += 2;
      continue;
    }
    i++;
  }
  return spans;
}

/** Which toolbar buttons should show as pressed for this selection. */
export function activeFormats(text: string, selStart: number, selEnd: number): { bold: boolean; bullets: boolean; heading: boolean } {
  const s = Math.min(selStart, selEnd);
  const e = Math.max(selStart, selEnd);
  const starts = linesFor(text, s, e);
  const every = (prefix: string) => starts.length > 0 && starts.every((st) => lineAt(text, st).startsWith(prefix));
  const lineStart = text.lastIndexOf('\n', s - 1) + 1;
  const bold = boldSpans(text, lineStart).some(([open, end]) => (open + 2 <= s && e <= end - 2) || (open === s && end === e));
  return { bold, bullets: every('- '), heading: every('## ') };
}

/**
 * Cleans a URL typed into the link field: trims it, adds https:// when no
 * scheme is given, and returns null unless it is a safe http(s) link.
 */
export function normaliseLinkUrl(raw: string): string | null {
  let url = raw.trim();
  if (url === '') return null;
  if (!/^https?:\/\//i.test(url)) {
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(url)) return null;
    url = `https://${url.replace(/^\/\//, '')}`;
  }
  return isSafeLinkUrl(url) ? url : null;
}
