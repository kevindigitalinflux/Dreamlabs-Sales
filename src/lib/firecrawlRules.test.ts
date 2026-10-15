import { describe, expect, it } from 'vitest';
import { chooseFirecrawlPage, firecrawlDomainFor, firecrawlTimeoutFor, parseFirecrawlReply, FIRECRAWL_MAX_BYTES } from '../../supabase/functions/_shared/firecrawlRules';
import { creditLine, problemLines } from '../../supabase/functions/_shared/deepFindProblems';

describe('Firecrawl rules', () => {
  it('only chooses from confirmed domains and skips when people already have roles', () => {
    expect(firecrawlDomainFor([], false)).toBeNull();
    expect(firecrawlDomainFor(['example.com'], true)).toBeNull();
    expect(firecrawlDomainFor(['127.0.0.1', 'facebook.com', 'example.com', 'other.com'], false)).toBe('example.com');
  });
  it('chooses one seen team/about link on the confirmed domain, stripping query and fragment', () => {
    expect(chooseFirecrawlPage('example.com', ['<a href="/about?token=ignore#team">About</a><a href="/team">Team</a>']))
      .toBe('https://example.com/team');
  });
  it('uses home when no eligible link exists, never guesses a team URL', () => {
    expect(chooseFirecrawlPage('example.com', ['<a href="https://other.com/team">Other</a><a href="http://127.0.0.1/team">Bad</a>']))
      .toBe('https://example.com/');
  });
  it('rejects unsafe domains and deceptive or off-domain links', () => {
    expect(chooseFirecrawlPage('127.0.0.1', [])).toBeNull();
    expect(chooseFirecrawlPage('example.com@127.0.0.1', [])).toBeNull();
    expect(chooseFirecrawlPage('example.com', ['<a href="https://user:pass@example.com/team">Bad</a><a href="//evil.example.com/team">Bad</a>']))
      .toBe('https://example.com/');
  });
  it('keeps 30 seconds plus overhead downstream, caps at 12 seconds, minimum 5 seconds', () => {
    expect(firecrawlTimeoutFor(36_999)).toBeNull();
    expect(firecrawlTimeoutFor(37_000)).toBe(5000);
    expect(firecrawlTimeoutFor(40_000)).toBe(8000);
    expect(firecrawlTimeoutFor(100_000)).toBe(12000);
  });
  it('uses existing extractors, retains own-domain emails only and caps names', () => {
    const html = '<p>Jane Smith, Managing Director</p><a href="mailto:jane@example.com">Jane</a> other@evil.com';
    expect(parseFirecrawlReply({ success: true, data: { rawHtml: html, metadata: { sourceURL: 'https://example.com/team' } } }, 'example.com'))
      .toMatchObject({ people: [{ name: 'Jane Smith', role: 'Managing Director' }], emails: ['jane@example.com'] });
    const many = Array.from({ length: 20 }, (_, i) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Person', name: `Jane Surname${String.fromCharCode(65 + i)}`, jobTitle: 'Director' })}</script>`).join('');
    expect(parseFirecrawlReply({ success: true, data: { rawHtml: many } }, 'example.com')?.people.length).toBeLessThanOrEqual(10);
  });
  it.each([null, { success: false }, { success: true, data: { rawHtml: 'x'.repeat(FIRECRAWL_MAX_BYTES + 1) } },
    { success: true, data: { rawHtml: 'text', metadata: { url: 'http://127.0.0.1' } } },
    { success: true, data: { rawHtml: 'text', metadata: { url: 'https://other.com' } } }])('rejects malformed, oversized or redirected output', (reply) => {
    expect(parseFirecrawlReply(reply, 'example.com')).toBeNull();
  });
  it('adds a fixed Firecrawl problem label and optional credits without breaking old wording', () => {
    expect(problemLines([{ step: 'firecrawl', target: 'example.com', failure: '402' }])[0]).toContain('Firecrawl');
    expect(creditLine({ hunter: {}, ai: {} })).toBe('Credits used: Hunter 0, AI 0.');
    expect(creditLine({ hunter: {}, ai: {}, firecrawl: 0 })).toBe('Credits used: Hunter 0, AI 0.');
    expect(creditLine({ hunter: {}, ai: {}, firecrawl: 1 })).toBe('Credits used: Hunter 0, AI 0, Firecrawl 1 page.');
  });
});
