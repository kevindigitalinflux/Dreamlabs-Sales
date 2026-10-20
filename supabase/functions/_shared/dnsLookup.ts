// supabase/functions/_shared/dnsLookup.ts
// MX check through Cloudflare DNS-over-HTTPS. Only a hostname that passes DOMAIN_CHECKS (clean public hostname, not
// free-mail, directory or internal) is ever sent, and only as the `name` query parameter of this one fixed endpoint:
// nothing here fetches the domain itself, so there is no SSRF surface. No key is needed.
import { cancelBody, readCapped } from './cappedBody.ts';
import { DOMAIN_CHECKS } from './domainChecks.ts';
import { parseDohMx } from './domainDiscovery.ts';

const DOH_URL = 'https://cloudflare-dns.com/dns-query';

export type MailProvider = 'google' | 'microsoft' | 'hosted' | 'unknown';
/** Only validated MX host suffixes count; provider response prose never reaches the result. */
export function classifyMailProvider(json: unknown): MailProvider {
  if (!json || typeof json !== 'object' || parseDohMx(json) !== 'mx') return 'unknown';
  const answers = (json as { Answer?: { type?: unknown; data?: unknown }[] }).Answer ?? [];
  const hosts = answers.filter(a => a.type === 15 && typeof a.data === 'string')
    .map(a => String(a.data).trim().toLowerCase().replace(/^\d+\s+/, '').replace(/\.$/, ''));
  const has = (suffix: string) => hosts.some(h => h === suffix || h.endsWith('.' + suffix));
  if (has('google.com') || has('googlemail.com')) return 'google';
  if (has('mail.protection.outlook.com')) return 'microsoft';
  if (['zoho.com', 'zoho.eu', 'mimecast.com', 'pphosted.com', 'emailsrvr.com', 'messagelabs.com', 'secureserver.net', 'protonmail.ch'].some(has)) return 'hosted';
  return 'unknown';
}

// Bounded, short-lived DNS metadata. Reuses the answer already fetched by discovery.
const providers = new Map<string, { provider: MailProvider; expires: number }>();
export function cachedMailProvider(domain: string): MailProvider | null {
  const entry = providers.get(domain.toLowerCase());
  return entry && entry.expires > Date.now() ? entry.provider : null;
}

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
    try {
      const json = JSON.parse(text);
      if (providers.size >= 256) providers.delete(providers.keys().next().value!);
      providers.set(d, { provider: classifyMailProvider(json), expires: Date.now() + 300_000 });
      return parseDohMx(json);
    } catch { return 'error'; }
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}
