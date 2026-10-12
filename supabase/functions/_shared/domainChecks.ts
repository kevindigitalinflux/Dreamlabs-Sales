// supabase/functions/_shared/domainChecks.ts
// The hostname rules every discovered or saved company domain must pass. Only imports other import-free modules, so it
// is usable from Deno and from Vitest.
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { isDirectoryDomain } from './knownPerson.ts';
import { cleanCompanyDomain, isFreeMailDomain } from './knownPersonWide.ts';
import type { DomainChecks } from './domainDiscovery.ts';

/** A clean public hostname (no internal or IP hosts), not free-mail, not a social or directory site. */
export const DOMAIN_CHECKS: DomainChecks = {
  clean: cleanCompanyDomain,
  usable: (d) => parseSafeWebsiteUrl(`https://${d}`) !== null && !isDirectoryDomain(d) && !isFreeMailDomain(d),
};

/** leads.email_domains as a clean list: every value re-checked, because the column is plain data. At most 8. */
export function savedDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value.slice(0, 20)) {
    const d = DOMAIN_CHECKS.clean(v);
    if (d && DOMAIN_CHECKS.usable(d) && !out.includes(d) && out.length < 8) out.push(d);
  }
  return out;
}
