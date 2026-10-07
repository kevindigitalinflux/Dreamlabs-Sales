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
