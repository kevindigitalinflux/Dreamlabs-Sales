import { describe, expect, it } from 'vitest';
import { isPrivateOrLoopbackHost, parseSafeWebsiteUrl, resolveSafeRedirect } from '../../supabase/functions/_shared/hostGuard';

const blockedUrls = [
  'http://localhost/', 'http://LOCALHOST/', 'http://localhost./', 'http://localhost:8080/', 'https://intranet',
  'http://127.0.0.1/', 'http://127.1.2.3/', 'http://0.0.0.0/', 'http://10.0.0.5/', 'http://10.255.255.255/',
  'http://172.16.0.1/', 'http://172.31.255.1/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data',
  'http://100.64.0.1/', 'http://100.127.255.254/',
  'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:10.0.0.1]/',
  'http://[fc00::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/',
  'http://intranet/', 'http://router/', 'http://printer.local/', 'http://db.internal/', 'http://a.localhost/',
  'http://nas.lan/', 'http://x.home/', 'http://x.corp/', 'http://x.intranet/', 'http://x.localdomain/',
  'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/',
  'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/',
  'http://user:pass@example.com/', 'http://user@example.com/',
  'http://localhost../', 'http://localhost.../', 'http://a..b/', 'http://[::ffff:a00:1]/',
  'http://[::7f00:1]/', 'http://[::a00:1]/', 'http://[::ffff:0:7f00:1]/', 'http://[::ffff:0:a00:1]/',
  'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::808:808]/', 'http://[64:ff9b:1::1]/', 'http://[2002:7f00:1::1]/', 'http://[2002::1]/',
];
const allowedUrls = [
  'https://acme.co.uk', 'https://fcbarcelona.com', 'https://fdic.gov', 'https://www.example.com',
  'https://a.b.c.example.org', 'http://example.com:8080/x', 'http://[2001:db8::1]/', 'http://100.63.0.1/',
  'http://100.128.0.1/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://8.8.8.8/', 'https://example.com.',
  'http://192.167.0.1/', 'http://192.169.0.1/', 'http://169.253.1.1/', 'http://169.255.1.1/',
  'http://[2606:4700:4700::1111]/', 'http://[2a00:1450:4009:81f::200e]/', 'http://[64:ff9a::1]/', 'http://[2003::1]/',
];

describe('parseSafeWebsiteUrl', () => {
  it.each(blockedUrls)('blocks %s', (u) => expect(parseSafeWebsiteUrl(u)).toBeNull());
  it.each(allowedUrls)('allows %s', (u) => expect(parseSafeWebsiteUrl(u)).not.toBeNull());
  it('returns null for garbage', () => expect(parseSafeWebsiteUrl('not a url')).toBeNull());
  // leadResearch.withScheme prefixes https:// to scheme-less values; these are the resulting inputs.
  it.each(['https://intranet', 'https://localhost:8080', 'https://printer.local'])('stays blocked after scheme prefixing: %s',
    (u) => expect(parseSafeWebsiteUrl(u)).toBeNull());
});

describe('isPrivateOrLoopbackHost', () => {
  it.each(['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '[::1]', '[fd00::1]', 'intranet', 'a.internal', 'localhost..', 'a..b', '.example.com', '[::7f00:1]', '[::ffff:0:7f00:1]', '[64:ff9b::1]', '[2002::1]'])(
    'blocks %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(true));
  it.each(['acme.co.uk', 'fcbarcelona.com', 'fdic.gov', 'fd.example.com', '[2001:db8::1]'])(
    'allows %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(false));
});

describe('resolveSafeRedirect', () => {
  const base = 'https://example.com/a/b';
  it('resolves a relative Location against the current URL', () =>
    expect(resolveSafeRedirect(base, '/c?d=1')?.toString()).toBe('https://example.com/c?d=1'));
  it('resolves a path-relative Location', () =>
    expect(resolveSafeRedirect(base, 'x')?.toString()).toBe('https://example.com/a/x'));
  it('allows an absolute public URL', () =>
    expect(resolveSafeRedirect(base, 'https://www.example.org/')?.hostname).toBe('www.example.org'));
  it.each([
    'http://169.254.169.254/latest/meta-data', 'http://localhost/', 'http://10.0.0.5/', '//127.0.0.1/', 'http://[::1]/',
    'ftp://example.com/', 'javascript:alert(1)', 'file:///etc/passwd', 'http://user:pass@example.com/', 'http://[::ffff:7f00:1]/',
  ])('blocks %s', (loc) => expect(resolveSafeRedirect(base, loc)).toBeNull());
  it('returns null for a missing or empty Location', () => {
    expect(resolveSafeRedirect(base, null)).toBeNull();
    expect(resolveSafeRedirect(base, '')).toBeNull();
  });
  it('returns null for an unparseable Location', () => expect(resolveSafeRedirect(base, 'http://')).toBeNull());
});
