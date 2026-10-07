import { describe, expect, it } from 'vitest';
import {
  formatResearchNote,
  pickResearchLinks,
  stripToText,
} from '../../supabase/functions/_shared/researchPages';

describe('pickResearchLinks', () => {
  const base = 'https://acme.co.uk/';

  it('keeps relevant same-origin links, resolving relative hrefs', () => {
    const out = pickResearchLinks(base, ['/about-us', 'https://acme.co.uk/our-team', '/privacy']);
    expect(out).toEqual(['https://acme.co.uk/about-us', 'https://acme.co.uk/our-team']);
  });

  it('drops other origins, mailto/tel/javascript, and the homepage', () => {
    const out = pickResearchLinks(base, [
      'https://other.com/about',
      'mailto:hi@acme.co.uk',
      'tel:0123',
      'javascript:void(0)',
      '/',
      '#about',
      '/about',
    ]);
    expect(out).toEqual(['https://acme.co.uk/about']);
  });

  it('drops duplicates (ignoring fragments and trailing slashes)', () => {
    const out = pickResearchLinks(base, ['/about', '/about/', '/about#team', 'https://acme.co.uk/about']);
    expect(out).toEqual(['https://acme.co.uk/about']);
  });

  it('respects max, defaulting to 4', () => {
    const hrefs = ['/about', '/team', '/services', '/products', '/news', '/blog'];
    expect(pickResearchLinks(base, hrefs)).toHaveLength(4);
    expect(pickResearchLinks(base, hrefs, 2)).toHaveLength(2);
  });

  it('returns [] for an invalid base url', () => {
    expect(pickResearchLinks('not a url', ['/about'])).toEqual([]);
  });
});

describe('stripToText', () => {
  it('removes script, style and tags', () => {
    const html = '<style>p{color:red}</style><script>alert(1)</script><p>Hello <b>world</b></p>';
    expect(stripToText(html)).toBe('Hello world');
  });

  it('collapses whitespace', () => {
    expect(stripToText('<p>a\n\n   b\t\tc</p>')).toBe('a b c');
  });

  it('truncates to maxChars', () => {
    expect(stripToText('<p>' + 'x'.repeat(100) + '</p>', 10)).toBe('x'.repeat(10));
  });

  it('defaults to 6000 characters', () => {
    expect(stripToText('y'.repeat(7000))).toHaveLength(6000);
  });
});

describe('formatResearchNote', () => {
  it('lists sources and both sections', () => {
    const out = formatResearchNote({
      website: '- Family run since 1990',
      web: '- Won an award in 2025',
      sources: ['https://a.com', 'https://b.com'],
    });
    expect(out).toContain('From their website');
    expect(out).toContain('Family run since 1990');
    expect(out).toContain('From the web');
    expect(out).toContain('Won an award in 2025');
    expect(out).toContain('Sources');
    expect(out).toContain('https://a.com');
    expect(out).toContain('https://b.com');
  });

  it('omits empty sections', () => {
    const out = formatResearchNote({ website: null, web: '- Only web', sources: [] });
    expect(out).not.toContain('From their website');
    expect(out).not.toContain('Sources');
    expect(out).toContain('Only web');
  });

  it('returns an empty string when there is nothing', () => {
    expect(formatResearchNote({ website: '  ', web: null, sources: [] })).toBe('');
  });
});

describe('pickResearchLinks (fix round)', () => {
  const base = 'https://acme.co.uk/';

  it('excludes file extensions case-insensitively', () => {
    const out = pickResearchLinks(base, [
      '/about/brochure.pdf', '/team.ZIP', '/news/photo.JPG', '/blog/feed.xml', '/about.css',
      '/services/data.json', '/about/app.js', '/team/pic.svg', '/about-us',
    ]);
    expect(out).toEqual(['https://acme.co.uk/about-us']);
  });

  it('dedupes links that differ only by query string', () => {
    expect(pickResearchLinks(base, ['/about?x=1', '/about?x=2', '/about'])).toEqual(['https://acme.co.uk/about?x=1']);
  });

  it('handles protocol-relative links', () => {
    expect(pickResearchLinks(base, ['//acme.co.uk/about', '//evil.com/about'])).toEqual(['https://acme.co.uk/about']);
  });

  it('resolves relative links against a base with a path', () => {
    expect(pickResearchLinks('https://acme.co.uk/company/', ['about'])).toEqual(['https://acme.co.uk/company/about']);
  });

  it('matches uppercase paths', () => {
    expect(pickResearchLinks(base, ['/ABOUT-US'])).toEqual(['https://acme.co.uk/ABOUT-US']);
  });

  it('returns nothing for max = 0', () => {
    expect(pickResearchLinks(base, ['/about'], 0)).toEqual([]);
  });
});

describe('stripToText (fix round)', () => {
  it('strips an unclosed script to the end', () => {
    expect(stripToText('<p>Hi</p><script>var a = 1; secret()')).toBe('Hi');
  });

  it('strips noscript and svg blocks, including unclosed ones', () => {
    expect(stripToText('a<noscript>x</noscript>b<svg><path/></svg>c')).toBe('a b c');
    expect(stripToText('a<svg><path d="M0"/>')).toBe('a');
  });

  it('strips comments, including unclosed ones', () => {
    expect(stripToText('a<!-- hidden -->b')).toBe('a b');
    expect(stripToText('a<!-- never closed')).toBe('a');
  });

  it('decodes nbsp and amp', () => {
    expect(stripToText('<p>Tom&nbsp;&amp;&nbsp;Jerry</p>')).toBe('Tom & Jerry');
  });

  it('handles > inside a quoted attribute', () => {
    expect(stripToText('<a title="a>b">text</a>')).toBe('text');
  });

  it('keeps a literal less-than sign in text', () => {
    expect(stripToText('1 < 2')).toBe('1 < 2');
  });

  it('is linear on hostile input', () => {
    const start = Date.now();
    stripToText('<script>'.repeat(40000));
    stripToText('<script>x</script>'.repeat(16000));
    stripToText('<a '.repeat(100000));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('formatResearchNote (exact)', () => {
  it('formats exactly', () => {
    expect(formatResearchNote({ website: ' - A ', web: '- B', sources: ['https://x.com'] })).toBe(
      'From their website:\n- A\n\nFrom the web:\n- B\n\nSources:\n- https://x.com',
    );
  });
});
