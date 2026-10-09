import { describe, expect, it } from 'vitest';
import {
  domainFromWebsite,
  emailOnDomain,
  emailTakenByOther,
  isDirectoryDomain,
  isLinkedinUrl,
  mergeFoundIntoPerson,
  needsRateSlot,
  normName,
  planLookups,
  LOOKUP_LIMIT_MESSAGE,
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

describe('normName', () => {
  it('trims, collapses spaces, lowercases and strips diacritics', () => {
    expect(normName('  José   María ')).toBe('jose maria');
    expect(normName('ÉLODIE')).toBe('elodie');
    expect(normName(null)).toBe('');
  });
});

describe('isLinkedinUrl', () => {
  it('accepts https linkedin.com hosts only', () => {
    expect(isLinkedinUrl('https://www.linkedin.com/in/jane')).toBe(true);
    expect(isLinkedinUrl('https://linkedin.com/in/jane')).toBe(true);
    expect(isLinkedinUrl('https://uk.linkedin.com/in/jane')).toBe(true);
    expect(isLinkedinUrl('http://linkedin.com/in/jane')).toBe(false);
    expect(isLinkedinUrl('https://evil-linkedin.com/in/jane')).toBe(false);
    expect(isLinkedinUrl('https://linkedin.com.evil.com/in/jane')).toBe(false);
    expect(isLinkedinUrl('https://linkedin.com@evil.com/')).toBe(false);
    expect(isLinkedinUrl('')).toBe(false);
  });
});

describe('isDirectoryDomain', () => {
  it('flags social, builder and directory domains and their subdomains', () => {
    for (const d of ['facebook.com', 'm.facebook.com', 'x.com', 'linktr.ee', 'yell.com', 'acme.wixsite.com', 'acme.wordpress.com']) {
      expect(isDirectoryDomain(d)).toBe(true);
    }
    for (const d of ['acme.com', 'notfacebook.com', 'max.com', null]) expect(isDirectoryDomain(d)).toBe(false);
  });
});

describe('emailOnDomain / emailTakenByOther', () => {
  it('compares the email domain exactly', () => {
    expect(emailOnDomain('a@Acme.com', 'acme.com')).toBe(true);
    expect(emailOnDomain('a@mail.acme.com', 'acme.com')).toBe(false);
    expect(emailOnDomain('a@acme.com', null)).toBe(false);
  });
  it('detects an email on another row, any case, ignoring self', () => {
    const rows = [{ id: '1', email: 'A@x.com' }, { id: '2', email: null }];
    expect(emailTakenByOther('a@X.com', rows, '2')).toBe(true);
    expect(emailTakenByOther('a@x.com', rows, '1')).toBe(false);
    expect(emailTakenByOther('', rows, '2')).toBe(false);
  });
});

describe('planLookups', () => {
  const base = {
    usePaid: true, hunterKey: true, apolloKey: true, domainOk: true,
    hasFirst: true, hasLast: true, hasEmail: false, hasLinkedin: false, hasApolloId: false,
  };
  it('calls both when email and LinkedIn are blank', () => {
    expect(planLookups(base)).toEqual({ hunter: true, apollo: true });
  });
  it('phone alone never triggers Apollo', () => {
    expect(planLookups({ ...base, hasEmail: true, hasLinkedin: true })).toEqual({ hunter: false, apollo: false });
  });
  it('Apollo still runs for a blank LinkedIn when the email is present; Hunter does not', () => {
    expect(planLookups({ ...base, hasEmail: true })).toEqual({ hunter: false, apollo: true });
  });
  it('skips Apollo for an existing Apollo record', () => {
    expect(planLookups({ ...base, hasApolloId: true })).toEqual({ hunter: true, apollo: false });
  });
  it('opt-out, missing domain, missing keys and missing last name', () => {
    expect(planLookups({ ...base, usePaid: false })).toEqual({ hunter: false, apollo: false });
    expect(planLookups({ ...base, domainOk: false })).toEqual({ hunter: false, apollo: false });
    expect(planLookups({ ...base, hunterKey: false, apolloKey: false })).toEqual({ hunter: false, apollo: false });
    expect(planLookups({ ...base, hasLast: false })).toEqual({ hunter: false, apollo: true });
  });
});

describe('rate limit decision', () => {
  it('uses a slot only when a paid call is planned', () => {
    expect(needsRateSlot({ hunter: false, apollo: false })).toBe(false);
    expect(needsRateSlot({ hunter: true, apollo: false })).toBe(true);
    expect(needsRateSlot({ hunter: false, apollo: true })).toBe(true);
  });
  it('has a fixed plain-English limit message', () => {
    expect(LOOKUP_LIMIT_MESSAGE).toBe('Daily lookup limit reached for this lead; try again tomorrow');
  });
});
