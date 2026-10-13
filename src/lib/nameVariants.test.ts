import { describe, expect, it } from 'vitest';
import { companyNameVariants, compactName, coreWords, sameCompanyName } from '../../supabase/functions/_shared/nameVariants';

describe('name variants', () => {
  it('builds ranked, distinct variants for Love Living', () => {
    expect(companyNameVariants(['Love Living']).map((v) => v.text)).toEqual([
      'love living', 'loveliving', 'love-living', 'loveliving london', 'loveliving uk', 'love living management', 'love living ltd',
    ]);
  });
  it('drops generic words and swaps "&" and "and"', () => {
    expect(coreWords('The Smith & Sons Group Ltd')).toEqual(['smith', 'and', 'sons']);
    const v = companyNameVariants(['Smith & Sons Ltd']).map((x) => x.text);
    expect(v).toContain('smith & sons');
    expect(v).toContain('smith sons');
    expect(v).toContain('smithsons');
    expect(v.length).toBeLessThanOrEqual(8);
  });
  it('treats spacing and legal forms as the same name', () => {
    expect(compactName('LOVELIVING LIMITED')).toBe('loveliving');
    expect(sameCompanyName('LOVELIVING LIMITED', 'Love Living')).toBe(true);
    expect(sameCompanyName('Love Living Management Ltd', 'Love Living')).toBe(true);
    expect(sameCompanyName('Living With Love Ltd', 'Love Living')).toBe(false);
    expect(sameCompanyName('Ltd', 'Limited')).toBe(false);
  });
  it('ignores odd input', () => {
    expect(companyNameVariants([''])).toEqual([]);
    expect(coreWords(5)).toEqual([]);
  });
});

describe('registrySearchNames', () => {
  it('searches the name as written, as one word and with management, at most 4', async () => {
    const { registrySearchNames } = await import('../../supabase/functions/_shared/nameVariants');
    expect(registrySearchNames('Love Living')).toEqual(['love living', 'loveliving', 'love living management']);
    expect(registrySearchNames('Smith & Sons').length).toBeLessThanOrEqual(4);
  });
});
