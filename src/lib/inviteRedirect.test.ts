import { describe, expect, it } from 'vitest';
import { isAllowedInviteRedirect, publicAppUrl } from '../../supabase/functions/_shared/appUrl';

const ORIGINS = 'http://localhost:5173,https://sales.didreamlabs.com,https://dreamlabs-sales.kevindigitalinflux.workers.dev';

describe('isAllowedInviteRedirect', () => {
  it('accepts the listed app addresses with the welcome path', () => {
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome', ORIGINS)).toBe(true);
    expect(isAllowedInviteRedirect('http://localhost:5173/welcome', ORIGINS)).toBe(true);
    expect(isAllowedInviteRedirect('https://dreamlabs-sales.kevindigitalinflux.workers.dev/welcome', ORIGINS)).toBe(true);
  });
  it('tolerates spaces and trailing slashes in the configured list', () => {
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome', ' https://sales.didreamlabs.com/ , http://localhost:5173')).toBe(true);
  });
  it('rejects lookalike hosts that only start with an allowed address', () => {
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com.example.org/welcome', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com@example.org/welcome', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://evil.example/https://sales.didreamlabs.com/welcome', ORIGINS)).toBe(false);
  });
  it('rejects the wrong path, extras on the address, a different port or scheme', () => {
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome/extra', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome?next=//evil.example', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome#x', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('http://localhost:5174/welcome', ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('http://sales.didreamlabs.com/welcome', ORIGINS)).toBe(false);
  });
  it('rejects empty, unparsable and non-web values, and an empty allow-list', () => {
    for (const value of ['', 'welcome', '/welcome', 'javascript:alert(1)', 'not a url']) expect(isAllowedInviteRedirect(value, ORIGINS)).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome', '')).toBe(false);
    expect(isAllowedInviteRedirect('https://sales.didreamlabs.com/welcome', undefined)).toBe(false);
  });
});

describe('publicAppUrl for emailed links', () => {
  it('uses the explicit public address even when the origins list starts with another one', () => {
    expect(publicAppUrl('https://sales.didreamlabs.com/', 'https://dreamlabs-sales.kevindigitalinflux.workers.dev,https://sales.didreamlabs.com')).toBe('https://sales.didreamlabs.com');
  });
});
