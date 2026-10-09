// supabase/functions/_shared/knownPersonLookup.ts
// Provider calls for the known-person lookup. Keys are only ever sent to the provider: never logged, returned, or put in an error.
import { fetchWithTimeout } from './fetchWithTimeout.ts';
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { validateContactEdit } from './contacts.ts';
import type { FoundFields, LookupFailure } from './knownPerson.ts';

export type LookupResult = { ok: true; found: FoundFields } | { ok: false; failure: LookupFailure };

/** A domain is only handed to providers (we never fetch it ourselves), but still refuse internal-looking hosts. */
export function isPublicDomain(domain: string): boolean {
  return parseSafeWebsiteUrl(`https://${domain}`) !== null;
}

function failureOf(err: unknown): LookupFailure {
  return err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
}

/** Keeps one found value only when it passes the same validation as typed contact fields. */
export function cleanFoundField(field: 'email' | 'phone' | 'linkedin_url', value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const res = validateContactEdit({ kind: 'person', first_name: 'x', [field]: value });
  return res.ok ? res.value[field] : null;
}

/**
 * Hunter email-finder for one named person at a domain. Only a reasonably confident match
 * (score >= 50) is used, like lookupHunterOwnerEmail.
 */
export async function hunterFindEmail(domain: string, first: string, last: string, apiKey: string): Promise<LookupResult> {
  try {
    const params = new URLSearchParams({ domain, first_name: first, last_name: last, api_key: apiKey });
    const res = await fetchWithTimeout(`https://api.hunter.io/v2/email-finder?${params}`);
    if (res.status === 404) return { ok: true, found: {} };
    if (!res.ok) return { ok: false, failure: res.status };
    const data = await res.json() as { data?: { email?: string | null; score?: number | null } };
    const email = (data.data?.score ?? 0) >= 50 ? cleanFoundField('email', data.data?.email) : null;
    return { ok: true, found: email ? { email } : {} };
  } catch (err) {
    return { ok: false, failure: failureOf(err) };
  }
}

/**
 * Apollo people/match by name + organization domain, WITHOUT personal-email or phone reveal.
 * Consumes Apollo credits when a person is matched. A match whose first name differs from the typed one is ignored.
 */
export async function apolloMatchPerson(domain: string, first: string, last: string, apiKey: string): Promise<LookupResult> {
  try {
    const res = await fetchWithTimeout('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ first_name: first, last_name: last, domain, reveal_personal_emails: false }),
    }, 8000);
    if (!res.ok) return { ok: false, failure: res.status };
    const data = await res.json() as {
      person?: { first_name?: string | null; email?: string | null; linkedin_url?: string | null; phone_numbers?: { sanitized_number?: string | null }[] };
    };
    const person = data.person;
    if (!person) return { ok: true, found: {} };
    if (person.first_name && first && person.first_name.trim().toLowerCase() !== first.trim().toLowerCase()) {
      return { ok: true, found: {} };
    }
    const found: FoundFields = {};
    const email = cleanFoundField('email', person.email);
    const phone = cleanFoundField('phone', person.phone_numbers?.[0]?.sanitized_number);
    const linkedin = cleanFoundField('linkedin_url', person.linkedin_url);
    if (email) found.email = email;
    if (phone) found.phone = phone;
    if (linkedin) found.linkedin_url = linkedin;
    return { ok: true, found };
  } catch (err) {
    return { ok: false, failure: failureOf(err) };
  }
}
