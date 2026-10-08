import { describe, expect, it } from 'vitest';
import { candidateSourceLabel, hasNoContactDetails, isRegistrySource } from './candidateSource';

describe('candidateSource', () => {
  it('labels sources readably', () => {
    expect(candidateSourceLabel('companies_house')).toBe('Companies House');
    expect(candidateSourceLabel('cro')).toBe('CRO');
    expect(candidateSourceLabel('hunter')).toBe('Hunter');
    expect(candidateSourceLabel('apollo')).toBe('Apollo');
    expect(candidateSourceLabel('manual')).toBe('Added manually');
    expect(candidateSourceLabel('dream_agent')).toBe('Dream Agent');
    expect(candidateSourceLabel('other')).toBe('other');
  });
  it('detects missing contact details', () => {
    expect(hasNoContactDetails({ email: null, phone: null })).toBe(true);
    expect(hasNoContactDetails({ email: '', phone: null })).toBe(true);
    expect(hasNoContactDetails({ email: null, phone: '0207' })).toBe(false);
    expect(hasNoContactDetails({ email: 'a@b.com', phone: '0207' })).toBe(false);
  });
  it('identifies registry sources', () => {
    expect(isRegistrySource('companies_house')).toBe(true);
    expect(isRegistrySource('cro')).toBe(true);
    expect(isRegistrySource('hunter')).toBe(false);
    expect(isRegistrySource('apollo')).toBe(false);
  });
});
