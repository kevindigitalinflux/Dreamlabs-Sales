import { describe, expect, it } from 'vitest';
import { guessLabel, inferDomainPattern, patternGuess, patternLine } from '../../supabase/functions/_shared/domainPattern';

describe('inferDomainPattern', () => {
  const people = [{ first: 'Max', last: 'Whatley' }, { first: 'David', last: 'Sipple' }];
  it('learns first@ from an address on the site that names a known person', () => {
    const p = inferDomainPattern('loveliving.uk', [{ email: 'max@loveliving.uk', first: null, last: null }, { email: 'info@loveliving.uk', first: null, last: null }], people);
    expect(p).toEqual({ pattern: '{first}', evidence: 1 });
    expect(patternLine('loveliving.uk', p!)).toBe('Email format on loveliving.uk looks like first@loveliving.uk (from 1 address).');
    expect(patternGuess(p!, { first: 'David', last: 'Sipple' }, 'loveliving.uk')).toBe('david@loveliving.uk');
    expect(guessLabel(p!, 'loveliving.uk')).toBe('Guess, unverified: looks like first@loveliving.uk');
  });
  it('uses addresses whose owner is known, and refuses when addresses disagree', () => {
    expect(inferDomainPattern('x.uk', [{ email: 'j.smith@x.uk', first: 'Jo', last: 'Smith' }], [])).toEqual({ pattern: '{f}.{last}', evidence: 1 });
    expect(inferDomainPattern('x.uk', [
      { email: 'j.smith@x.uk', first: 'Jo', last: 'Smith' }, { email: 'ann@x.uk', first: 'Ann', last: 'Lee' },
    ], [])).toBeNull();
    expect(inferDomainPattern('x.uk', [{ email: 'jo@other.uk', first: 'Jo', last: 'Smith' }], [])).toBeNull();
  });
});

describe('results view reads the address suggestions', () => {
  it('keeps only well-formed email suggestions', async () => {
    const { readDeepFindDetails } = await import('./deepFindView');
    const d = readDeepFindDetails({ suggestions: [
      { name: 'David Sipple', field: 'email', value: 'david@loveliving.uk', label: 'Guess, unverified: looks like first@loveliving.uk' },
      { name: 'X', field: 'phone', value: '1', label: 'y' }, 'junk',
    ] });
    expect(d.suggestions).toEqual([{ name: 'David Sipple', value: 'david@loveliving.uk', label: 'Guess, unverified: looks like first@loveliving.uk' }]);
  });
});
