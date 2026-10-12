import { describe, expect, it } from 'vitest';
import { stripAiPunctuation } from '../../supabase/functions/_shared/textGuardrails';

describe('stripAiPunctuation', () => {
  it('replaces a spaced dash used as clause punctuation with a comma', () => {
    expect(stripAiPunctuation('We help firms — big and small — grow')).toBe('We help firms, big and small, grow');
    expect(stripAiPunctuation('Quick note - thanks')).toBe('Quick note, thanks');
    expect(stripAiPunctuation('Quick note – thanks')).toBe('Quick note, thanks');
  });

  it('leaves hyphenated words alone', () => {
    expect(stripAiPunctuation('A well-known, up-to-date firm')).toBe('A well-known, up-to-date firm');
  });

  it('keeps bullet lines, including indented ones', () => {
    expect(stripAiPunctuation('Points:\n- Item one\n- Item two')).toBe('Points:\n- Item one\n- Item two');
    expect(stripAiPunctuation('Points:\n  - Item')).toBe('Points:\n  - Item');
    expect(stripAiPunctuation('- Item one')).toBe('- Item one');
  });

  it('keeps heading lines', () => {
    expect(stripAiPunctuation('## What we do\n- Cleaning')).toBe('## What we do\n- Cleaning');
  });
});
