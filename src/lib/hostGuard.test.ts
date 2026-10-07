import { describe, expect, it } from 'vitest';
import { isPrivateOrLoopbackHost, parseSafeWebsiteUrl } from '../../supabase/functions/_shared/hostGuard';

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
];
const allowedUrls = [
  'https://acme.co.uk', 'https://fcbarcelona.com', 'https://fdic.gov', 'https://www.example.com',
  'https://a.b.c.example.org', 'http://example.com:8080/x', 'http://[2001:db8::1]/', 'http://100.63.0.1/',
  'http://100.128.0.1/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://8.8.8.8/', 'https://example.com.',
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
  it.each(['localhost', 'LOCALHOST', 'localhost.', '127.0.0.1', '[::1]', '[fd00::1]', 'intranet', 'a.internal'])(
    'blocks %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(true));
  it.each(['acme.co.uk', 'fcbarcelona.com', 'fdic.gov', 'fd.example.com', '[2001:db8::1]'])(
    'allows %s', (h) => expect(isPrivateOrLoopbackHost(h)).toBe(false));
});
