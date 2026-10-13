// supabase/functions/_shared/dnsLookup.ts
// MX check through Cloudflare DNS-over-HTTPS. Only a hostname that passes DOMAIN_CHECKS (clean public hostname, not
// free-mail, directory or internal) is ever sent, and only as the `name` query parameter of this one fixed endpoint:
// nothing here fetches the domain itself, so there is no SSRF surface. No key is needed.
import { cancelBody, readCapped } from './cappedBody.ts';
import { DOMAIN_CHECKS } from './domainChecks.ts';
import { parseDohMx } from './domainDiscovery.ts';

const DOH_URL = 'https://cloudflare-dns.com/dns-query';

/** 'mx' when the domain has a real mail server, 'none' when it has none or does not exist, 'error' otherwise. Never throws. */
export async function lookupMx(domain: string, timeoutMs = 3000): Promise<'mx' | 'none' | 'error'> {
  const d = DOMAIN_CHECKS.clean(domain);
  if (!d || !DOMAIN_CHECKS.usable(d)) return 'error';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const res = await fetch(`${DOH_URL}?${new URLSearchParams({ name: d, type: 'MX' })}`, {
      headers: { accept: 'application/dns-json' }, signal: controller.signal, redirect: 'error',
    });
    if (!res.ok) { await cancelBody(res); return 'error'; }
    const text = await readCapped(res, controller.signal, 20_000);
    try { return parseDohMx(JSON.parse(text)); } catch { return 'error'; }
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}
