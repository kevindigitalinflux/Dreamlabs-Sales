// Pure, import-free SSRF host guard. Blocks the direct SSRF vectors for a
// caller-supplied website URL: non-http(s) schemes, URL credentials, loopback,
// RFC1918, CGNAT (100.64.0.0/10), link-local (incl. the 169.254.169.254 cloud
// metadata address), IPv6 loopback/unspecified/ULA/link-local/IPv4-mapped, and
// internal-looking hostnames (single-label names and .local/.internal/etc.).
// Does NOT defend against DNS rebinding (a public hostname resolving to a
// private IP at fetch time): Deno's edge runtime has no pre-fetch resolve step
// here, so this is a static check on the literal URL, not the network.

const INTERNAL_SUFFIXES = [
  '.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain',
];

function isPrivateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Decides for a bracket-less IPv6 literal (already lowercased). */
function isPrivateIpv6(addr: string): boolean {
  if (addr === '::' || addr === '::1') return true;
  // IPv4-mapped, dotted form (::ffff:127.0.0.1) or hex form (::ffff:7f00:1).
  const dotted = addr.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (dotted) return isPrivateIpv4(Number(dotted[1]), Number(dotted[2]));
  const hex = addr.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    return isPrivateIpv4(hi >> 8, hi & 0xff);
  }
  // Any other "::"-leading address: IPv4-compatible ::/96 (e.g. ::7f00:1) and SIIT ::ffff:0:0:0/96.
  // No public website is served from these, so block outright.
  if (addr.startsWith('::')) return true;
  const groups = addr.split(':');
  const h = parseInt(groups[0], 16);
  if (Number.isNaN(h)) return false;
  if (h === 0) return true; // ::/8 (first group zero, e.g. 0:1:2:3:4:5:6:7)
  if (h >= 0xfc00 && h <= 0xfdff) return true; // fc00::/7 unique local
  if (h >= 0xfe80 && h <= 0xfebf) return true; // fe80::/10 link-local
  if (h === 0x2002) return true; // 2002::/16 6to4 (embeds an IPv4 address)
  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64 (embed an IPv4 address).
  if (h === 0x64 && groups.length > 1 && parseInt(groups[1], 16) === 0xff9b) return true;
  return false;
}

/**
 * True when a URL hostname (as returned by `URL.hostname`, so IPv6 literals are
 * bracketed) points at, or looks like, an internal/loopback/private target.
 * IPv6 prefix rules apply only to bracketed literals, never to ordinary names.
 * Input MUST be the canonical `URL.hostname` (lowercased, IPv6 compressed with
 * hex groups, IPv4 normalised to dotted decimal); non-canonical spellings are
 * not guaranteed to be recognised.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) return isPrivateIpv6(host.slice(1, -1));
  host = host.replace(/\.+$/, '');
  if (host === '' || !host.includes('.')) return true; // single-label (localhost, intranet, router...)
  if (host.split('.').some((label) => label === '')) return true; // empty label (a..b, .x)
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s))) return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (ipv4) return isPrivateIpv4(Number(ipv4[1]), Number(ipv4[2]));
  return false;
}

/** Parses a website URL, returning null when it is unparseable or unsafe to fetch. */
export function parseSafeWebsiteUrl(website: string): URL | null {
  let url: URL;
  try {
    url = new URL(website);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (isPrivateOrLoopbackHost(url.hostname)) return null;
  return url;
}

/**
 * Resolves a redirect `Location` header against the URL that returned it and
 * re-applies the full guard to the result. Returns null for a missing/invalid
 * Location, a non-http(s) scheme, credentials or a blocked host.
 */
export function resolveSafeRedirect(currentUrl: string, location: string | null): URL | null {
  if (!location) return null;
  let next: string;
  try {
    next = new URL(location, currentUrl).toString();
  } catch {
    return null;
  }
  return parseSafeWebsiteUrl(next);
}
