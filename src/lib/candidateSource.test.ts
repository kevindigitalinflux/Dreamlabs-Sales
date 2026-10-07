import { describe, expect, it } from 'vitest';
import { candidateSourceLabel, hasNoContactDetails } from './candidateSource';

describe('candidateSource', () => {
  it('labels registry sources readably', () => {
    expect(candidateSourceLabel('companies_house')).toBe('Companies House');
    expect(candidateSourceLabel('cro')).toBe('CRO');
    expect(candidateSourceLabel('other')).toBe('other');
  });
  it('detects missing contact details', () => {
    expect(hasNoContactDetails({ email: null, phone: null })).toBe(true);
    expect(hasNoContactDetails({ email: 'a@b.com', phone: null })).toBe(false);
  });
});
