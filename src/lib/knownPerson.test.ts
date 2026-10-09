import { describe, expect, it } from 'vitest';
import {
  domainFromWebsite,
  mergeFoundIntoPerson,
  plainLookupError,
} from '../../supabase/functions/_shared/knownPerson';

describe('mergeFoundIntoPerson', () => {
  it('fills every blank field', () => {
    const r = mergeFoundIntoPerson(
      { title: null, email: '', phone: '  ', linkedin_url: undefined },
      { title: 'Owner', email: 'Jane@X.com', phone: '+44 20 7946 0000', linkedin_url: 'https://linkedin.com/in/jane' },
    );
    expect(r.patch).toEqual({
      title: 'Owner', email: 'jane@x.com', phone: '+44 20 7946 0000', linkedin_url: 'https://linkedin.com/in/jane',
    });
    expect(r.applied).toEqual({ email: 'jane@x.com', phone: '+44 20 7946 0000', linkedin_url: 'https://linkedin.com/in/jane' });
    expect(r.extra_email).toBeUndefined();
  });

  it('never overwrites a typed value', () => {
    const r = mergeFoundIntoPerson(
      { title: 'MD', email: 'me@x.com', phone: '0123456789', linkedin_url: 'https://linkedin.com/in/me' },
      { title: 'Owner', email: 'me@x.com', phone: '999999999', linkedin_url: 'https://linkedin.com/in/other' },
    );
    expect(r.patch).toEqual({});
    expect(r.applied).toEqual({});
  });

  it('returns a different found email as extra_email and does not save it', () => {
    const r = mergeFoundIntoPerson({ email: 'me@x.com' }, { email: 'other@x.com' });
    expect(r.patch).toEqual({});
    expect(r.applied).toEqual({});
    expect(r.extra_email).toBe('other@x.com');
  });

  it('treats the same email in a different case as the same, not extra', () => {
    const r = mergeFoundIntoPerson({ email: 'Me@X.com' }, { email: 'me@x.COM' });
    expect(r.extra_email).toBeUndefined();
    expect(r.patch).toEqual({});
  });

  it('still fills other blank fields when the email differs', () => {
    const r = mergeFoundIntoPerson({ email: 'me@x.com' }, { email: 'o@x.com', phone: '0123456789' });
    expect(r.patch).toEqual({ phone: '0123456789' });
    expect(r.applied).toEqual({ phone: '0123456789' });
    expect(r.extra_email).toBe('o@x.com');
  });

  it('ignores blank found values', () => {
    expect(mergeFoundIntoPerson({}, { email: ' ', phone: null, linkedin_url: '' })).toEqual({ patch: {}, applied: {} });
  });
});

describe('domainFromWebsite', () => {
  it.each([
    ['https://www.Example.com/about?x=1#y', 'example.com'],
    ['http://shop.example.co.uk/', 'shop.example.co.uk'],
    ['www.example.com', 'example.com'],
    ['example.com:8080/path', 'example.com'],
    ['  EXAMPLE.com.  ', 'example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(domainFromWebsite(input)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'localhost', 'https://user:pw@example.com', 'not a domain', 'a_b.com', '-a.com', 'x..com'])(
    'rejects %j',
    (input) => {
      expect(domainFromWebsite(input as string | null | undefined)).toBeNull();
    },
  );
});

describe('plainLookupError', () => {
  it('explains each failure in plain English', () => {
    expect(plainLookupError('hunter', 401)).toBe('Hunter did not accept the saved API key, so nothing was looked up.');
    expect(plainLookupError('apollo', 403)).toBe('Apollo did not accept the saved API key, so nothing was looked up.');
    expect(plainLookupError('apollo', 402)).toBe('Apollo says this account is out of credits, so nothing was looked up.');
    expect(plainLookupError('hunter', 429)).toBe('Hunter is limiting requests right now. Try again in a few minutes.');
    expect(plainLookupError('hunter', 'timeout')).toBe('Hunter took too long to answer. Try again in a moment.');
    expect(plainLookupError('apollo', 500)).toBe('Apollo could not be reached right now.');
    expect(plainLookupError('apollo', 'network')).toBe('Apollo could not be reached right now.');
  });
});
