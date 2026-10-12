import { describe, expect, it } from 'vitest';
import {
  hasFormatting,
  isSafeLinkUrl,
  parseEmail,
  renderEmailHtml,
  renderEmailText,
  type Block,
  type Inline,
} from '../../supabase/functions/_shared/emailFormat';

const para = (...lines: Inline[][]): Block => ({ kind: 'paragraph', lines });
const t = (text: string): Inline => ({ kind: 'text', text });
const b = (text: string): Inline => ({ kind: 'bold', text });
const l = (text: string, href: string): Inline => ({ kind: 'link', text, href });

describe('parseEmail: bold', () => {
  it('parses inline bold', () => {
    expect(parseEmail('Hello **world** there')).toEqual([para([t('Hello '), b('world'), t(' there')])]);
  });
  it('keeps an unclosed ** as literal text', () => {
    expect(parseEmail('Hello **world')).toEqual([para([t('Hello **world')])]);
  });
  it('keeps empty **** as literal text', () => {
    expect(parseEmail('a **** b')).toEqual([para([t('a **** b')])]);
  });
  it('keeps whitespace-only ** ** as literal text', () => {
    expect(parseEmail('a ** ** b')).toEqual([para([t('a ** ** b')])]);
  });
  it('never drops text with nested markers', () => {
    const blocks = parseEmail('**a **b** c**');
    expect(renderEmailText('**a **b** c**')).toBe('a b c');
    expect(blocks).toHaveLength(1);
  });
  it('keeps a substituted value containing ** and < intact', () => {
    expect(renderEmailText('Hi **Jo**hn<x>**')).toBe('Hi John<x>**');
    expect(renderEmailHtml('Hi **Jo**hn<x>**')).toContain('hn&lt;x&gt;**');
  });
});

describe('parseEmail: bullets', () => {
  it('groups consecutive bullet lines into one list', () => {
    expect(parseEmail('- one\n- **two**')).toEqual([{ kind: 'list', items: [[t('one')], [b('two')]] }]);
  });
  it('starts a list straight after a paragraph line and a paragraph after it', () => {
    expect(parseEmail('Points:\n- a\n- b\nThanks')).toEqual([
      para([t('Points:')]),
      { kind: 'list', items: [[t('a')], [t('b')]] },
      para([t('Thanks')]),
    ]);
  });
  it('does not treat mid-line hyphens as bullets', () => {
    expect(parseEmail('A well-known firm, 2 - 3 days')).toEqual([para([t('A well-known firm, 2 - 3 days')])]);
  });
  it('does not treat a lone "-" or "-item" as a bullet', () => {
    expect(parseEmail('-\n-item')).toEqual([para([t('-')], [t('-item')])]);
  });
});

describe('parseEmail: headings', () => {
  it('parses a ## heading', () => {
    expect(parseEmail('## What we do\nBody')).toEqual([
      { kind: 'heading', inline: [t('What we do')] },
      para([t('Body')]),
    ]);
  });
  it('does not treat ##text (no space) as a heading', () => {
    expect(parseEmail('##text')).toEqual([para([t('##text')])]);
  });
});

describe('parseEmail: links', () => {
  it('parses [text](url)', () => {
    expect(parseEmail('See [our site](https://example.com/a?b=1) now')).toEqual([
      para([t('See '), l('our site', 'https://example.com/a?b=1'), t(' now')]),
    ]);
  });
  it('makes a bare URL a link and strips trailing punctuation', () => {
    expect(parseEmail('Visit https://example.com/x.')).toEqual([
      para([t('Visit '), l('https://example.com/x', 'https://example.com/x'), t('.')]),
    ]);
    expect(parseEmail('(see https://example.com)')).toEqual([
      para([t('(see '), l('https://example.com', 'https://example.com'), t(')')]),
    ]);
  });
  it('keeps non-http and javascript: links literal', () => {
    expect(parseEmail('[x](ftp://a.com)')).toEqual([para([t('[x](ftp://a.com)')])]);
    expect(parseEmail('[click](javascript:alert(1))')).toEqual([para([t('[click](javascript:alert(1))')])]);
  });
  it('keeps a link whose host has no dot literal', () => {
    expect(parseEmail('[x](https://localhost)')).toEqual([para([t('[x](https://localhost)')])]);
  });
});

describe('parseEmail: paragraphs and line endings', () => {
  it('separates paragraphs on blank lines and keeps single newlines as line breaks', () => {
    expect(parseEmail('Hi Jo,\n\nLine one\nLine two')).toEqual([para([t('Hi Jo,')]), para([t('Line one')], [t('Line two')])]);
  });
  it('normalises CRLF', () => {
    expect(parseEmail('a\r\n\r\n- b\r\n')).toEqual([para([t('a')]), { kind: 'list', items: [[t('b')]] }]);
  });
  it('returns no blocks for an empty body', () => {
    expect(parseEmail('  \n\n')).toEqual([]);
  });
});

describe('isSafeLinkUrl', () => {
  it('accepts http(s) hosts with a dot and rejects everything else', () => {
    expect(isSafeLinkUrl('https://example.com')).toBe(true);
    expect(isSafeLinkUrl('http://a.co.uk/path')).toBe(true);
    expect(isSafeLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkUrl('https://user@evil.com')).toBe(false);
    expect(isSafeLinkUrl('https://exa mple.com')).toBe(false);
    expect(isSafeLinkUrl('https://localhost')).toBe(false);
  });
});

describe('hasFormatting', () => {
  it('is true for bold, bullets, headings and [text](url)', () => {
    expect(hasFormatting('a **b** c')).toBe(true);
    expect(hasFormatting('- item')).toBe(true);
    expect(hasFormatting('## Head')).toBe(true);
    expect(hasFormatting('[site](https://example.com)')).toBe(true);
  });
  it('is false for plain text, bare URLs and literal markers', () => {
    expect(hasFormatting('Hi Jo,\n\nA well-known firm, 2 - 3 days.')).toBe(false);
    expect(hasFormatting('click here to unsubscribe: https://sales.example.com/unsubscribe/abc')).toBe(false);
    expect(hasFormatting('a **b')).toBe(false);
    expect(hasFormatting('a ****')).toBe(false);
    expect(hasFormatting('##x\n-y')).toBe(false);
  });
});

describe('renderEmailText', () => {
  it('renders each construct as readable plain text', () => {
    const body = '## Our offer\n\nHi **Jo**,\nSee [our site](https://example.com).\n\n- one\n- two\n\nhttps://example.com/u';
    expect(renderEmailText(body)).toBe(
      'Our offer\n\nHi Jo,\nSee our site (https://example.com).\n\n- one\n- two\n\nhttps://example.com/u',
    );
  });
  it('shows just the URL when the link text equals the URL', () => {
    expect(renderEmailText('[https://example.com](https://example.com)')).toBe('https://example.com');
  });
});

describe('renderEmailHtml', () => {
  it('escapes HTML in text, link text and href', () => {
    const html = renderEmailHtml('<script>alert(1)</script> & "q" \'s <img src=x onerror=alert(1)>\n[a<b](https://e.com/?q="x")');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;s');
    expect(html).toContain('href="https://e.com/?q=&quot;x&quot;"');
    expect(html).toContain('>a&lt;b</a>');
  });
  it('turns the unsubscribe URL into a link while the text copy keeps it', () => {
    const body = '**Hi**\n\nclick here to unsubscribe: https://sales.example.com/unsubscribe/abc';
    expect(renderEmailHtml(body)).toContain(
      '<a href="https://sales.example.com/unsubscribe/abc" style="color:#2563eb" rel="noopener noreferrer">https://sales.example.com/unsubscribe/abc</a>',
    );
    expect(renderEmailText(body)).toContain('https://sales.example.com/unsubscribe/abc');
  });
  it('builds the expected structure for a representative email', () => {
    const html = renderEmailHtml('## Hello\n\nHi **Jo**,\nline two\n\n- a\n- b');
    expect(html.startsWith('<div style="font-family:')).toBe(true);
    expect(html).toContain('<p style="margin:16px 0 8px;font-size:17px;font-weight:700">Hello</p>');
    expect(html).toContain('<p style="margin:0 0 12px">Hi <strong>Jo</strong>,<br>line two</p>');
    expect(html).toContain('<ul style="margin:0 0 12px;padding-left:22px"><li style="margin:0 0 4px">a</li><li style="margin:0 0 4px">b</li></ul>');
    expect(html.endsWith('</div>')).toBe(true);
  });
});
