import { describe, expect, it } from 'vitest';
import { canonicalRedirect, LEGACY_HOST, MAIN_ORIGIN } from './canonicalRedirect';

describe('canonicalRedirect', () => {
  it('moves the old workers.dev address to the same page on the main address, keeping path, query and the # part', () => {
    expect(canonicalRedirect(`https://${LEGACY_HOST}/pipeline/list?stage=won#access_token=abc&type=recovery`)).toBe(`${MAIN_ORIGIN}/pipeline/list?stage=won#access_token=abc&type=recovery`);
    expect(canonicalRedirect(`https://${LEGACY_HOST}/`)).toBe(`${MAIN_ORIGIN}/`);
    expect(canonicalRedirect(`https://${LEGACY_HOST}`)).toBe(`${MAIN_ORIGIN}/`);
  });
  it('treats an http or upper-case address of the old host the same way', () => {
    expect(canonicalRedirect(`http://${LEGACY_HOST}/jobs`)).toBe(`${MAIN_ORIGIN}/jobs`);
    expect(canonicalRedirect(`https://${LEGACY_HOST.toUpperCase()}/jobs`)).toBe(`${MAIN_ORIGIN}/jobs`);
  });
  it('leaves the main address, localhost and Cloudflare preview addresses alone', () => {
    expect(canonicalRedirect(`${MAIN_ORIGIN}/login`)).toBeNull();
    expect(canonicalRedirect('http://localhost:5173/login')).toBeNull();
    expect(canonicalRedirect('http://127.0.0.1:5173/')).toBeNull();
    expect(canonicalRedirect('https://3f2a9c1-dreamlabs-sales.kevindigitalinflux.workers.dev/')).toBeNull();
    expect(canonicalRedirect(`https://${LEGACY_HOST}.example.org/`)).toBeNull();
    expect(canonicalRedirect(`https://evil.example/${LEGACY_HOST}`)).toBeNull();
  });
  it('ignores values that are not web addresses', () => {
    expect(canonicalRedirect('')).toBeNull();
    expect(canonicalRedirect('not a url')).toBeNull();
  });
});
