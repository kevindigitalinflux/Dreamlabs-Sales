import { describe, expect, it } from 'vitest';
import { isLongNote } from './noteSummary';

describe('isLongNote', () => {
  it('keeps short notes whole', () => {
    expect(isLongNote('Email sent: Hello (to a@b.co)', true)).toBe(false);
    expect(isLongNote('Email sent: Hello (to a@b.co)', false)).toBe(false);
  });
  it('shortens long notes sooner in compact spaces', () => {
    const text = 'x'.repeat(300);
    expect(isLongNote(text, true)).toBe(true);
    expect(isLongNote(text, false)).toBe(false);
  });
  it('counts lines as well as characters', () => {
    expect(isLongNote('a\nb\nc\nd', true)).toBe(true);
    expect(isLongNote('a\nb\nc\nd', false)).toBe(false);
    expect(isLongNote('a\nb\nc\nd\ne\nf\ng', false)).toBe(true);
  });
  it('treats one very long unbroken line as long', () => {
    expect(isLongNote('https://example.com/' + 'a'.repeat(700), false)).toBe(true);
  });
});
