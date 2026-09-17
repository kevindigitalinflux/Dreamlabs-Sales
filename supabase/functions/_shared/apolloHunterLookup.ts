// supabase/functions/_shared/apolloHunterLookup.ts
import { bareDomain } from './domain.ts';
import { fetchWithTimeout } from './fetchWithTimeout.ts';

/**
 * Apollo org-enrich by domain — company-level phone only (Apollo's people
 * search, which could get a true personal phone, needs a person's name to
 * search by, which these leads often don't have; company phone is what's
 * realistically available here). Returns null on no match or any error;
 * never throws, never writes anywhere — this is a read-only lookup for
 * bulk enrichment's review-before-apply flow.
 */
export async function lookupApolloPhone(website: string | null, apiKey: string): Promise<string | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetchWithTimeout(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { organization?: { primary_phone?: { number?: string } } };
    return data.organization?.primary_phone?.number ?? null;
  } catch {
    return null;
  }
}

/**
 * Hunter domain-search — highest-confidence email for the domain. Returns
 * null on no match or any error; never throws, never writes anywhere.
 */
export async function lookupHunterEmail(website: string | null, apiKey: string): Promise<string | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetchWithTimeout(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { emails?: { value: string; confidence: number }[] } };
    const emails = data.data?.emails ?? [];
    if (emails.length === 0) return null;
    return [...emails].sort((a, b) => b.confidence - a.confidence)[0]!.value;
  } catch {
    return null;
  }
}
