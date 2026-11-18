import { describe, expect, it } from 'vitest';
import { authRedirectUrl } from './authRedirect';

describe('authRedirectUrl', () => {
  it('joins the address the visitor is on to the path with exactly one slash', () => {
    expect(authRedirectUrl('/auth/callback', 'https://sales.didreamlabs.com')).toBe('https://sales.didreamlabs.com/auth/callback');
    expect(authRedirectUrl('/welcome', 'https://sales.didreamlabs.com/')).toBe('https://sales.didreamlabs.com/welcome');
    expect(authRedirectUrl('/reset-password', 'http://localhost:5173')).toBe('http://localhost:5173/reset-password');
  });
  it('never swaps in a different address than the one given', () => {
    const workers = 'https://dreamlabs-sales.kevindigitalinflux.workers.dev';
    expect(authRedirectUrl('/auth/callback', workers)).toBe(`${workers}/auth/callback`);
  });
  it('refuses an address that is not http or https', () => {
    expect(() => authRedirectUrl('/welcome', 'javascript:alert(1)')).toThrow();
    expect(() => authRedirectUrl('/welcome', 'ftp://example.com')).toThrow();
    expect(() => authRedirectUrl('/welcome', 'null')).toThrow();
    expect(() => authRedirectUrl('/welcome', '')).toThrow();
  });
  it('refuses a path that does not start with a slash', () => {
    expect(() => authRedirectUrl('welcome', 'https://sales.didreamlabs.com')).toThrow();
    expect(() => authRedirectUrl('//evil.example', 'https://sales.didreamlabs.com')).not.toThrow();
    expect(authRedirectUrl('//evil.example', 'https://sales.didreamlabs.com')).toBe('https://sales.didreamlabs.com//evil.example');
  });
});
