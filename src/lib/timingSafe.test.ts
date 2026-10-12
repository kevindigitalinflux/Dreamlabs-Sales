import { describe, expect, it } from 'vitest';
import { cronSecretMatches, timingSafeEqualStrings } from '../../supabase/functions/_shared/timingSafe';

describe('cron secret comparison', () => {
  it('compares in constant time and fails closed', async () => {
    expect(await timingSafeEqualStrings('abc', 'abc')).toBe(true);
    expect(await timingSafeEqualStrings('abc', 'abd')).toBe(false);
    expect(await cronSecretMatches('s3cret', 's3cret')).toBe(true);
    expect(await cronSecretMatches('wrong', 's3cret')).toBe(false);
    expect(await cronSecretMatches(null, 's3cret')).toBe(false);
    expect(await cronSecretMatches('', '')).toBe(false);
    expect(await cronSecretMatches('x', undefined)).toBe(false);
  });
});
