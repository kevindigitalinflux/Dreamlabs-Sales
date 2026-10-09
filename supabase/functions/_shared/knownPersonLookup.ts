// supabase/functions/_shared/knownPersonLookup.ts
// Provider calls for the known-person lookup. Keys are only ever sent to the provider: never logged, returned, or put in an error.
import { cancelBody, readCapped } from './cappedBody.ts';
import { parseSafeWebsiteUrl } from './hostGuard.ts';
import { validateContactEdit } from './contacts.ts';
import { isLinkedinUrl, type FoundFields, type LookupFailure } from './knownPerson.ts';

export type LookupResult = { ok: true; found: FoundFields } | { ok: false; failure: LookupFailure };

const MAX_RESPONSE_BYTES = 200_000;

/** A domain is only handed to providers (we never fetch it ourselves), but still refuse internal-looking hosts. */
export function isPublicDomain(domain: string): boolean {
  return parseSafeWebsiteUrl(`https://${domain}`) !== null;
}

function failureOf(err: unknown): LookupFailure {
  return err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
}

/** Keeps one found value only when it passes the same validation as typed contact fields (and LinkedIn host rules). */
export function cleanFoundField(field: 'email' | 'phone' | 'linkedin_url', value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const res = validateContactEdit({ kind: 'person', first_name: 'x', [field]: value });
  if (!res.ok) return null;
  const v = res.value[field];
  return field === 'linkedin_url' && !isLinkedinUrl(v) ? null : v;
}

/** One provider call: the deadline covers headers AND body, and at most ~200 KB of body is read. */
async function callJson(url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      await cancelBody(res);
      return { status: res.status, data: null };
    }
    const text = await readCapped(res, controller.signal, MAX_RESPONSE_BYTES);
    if (controller.signal.aborted) throw new DOMException('timeout', 'AbortError');
    try {
      return { status: res.status, data: JSON.parse(text) };
    } catch {
      return { status: res.status, data: null };
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hunter email-finder for one named person at a domain. The key goes in the X-API-KEY header, not the URL.
 * Only a reasonably confident match (score >= 50) is used, like lookupHunterOwnerEmail.
 */
export async function hunterFindEmail(domain: string, first: string, last: string, apiKey: string): Promise<LookupResult> {
  try {
    const params = new URLSearchParams({ domain, first_name: first, last_name: last });
    const { status, data } = await callJson(`https://api.hunter.io/v2/email-finder?${params}`, { headers: { 'X-API-KEY': apiKey } }, 5000);
    if (status === 404) return { ok: true, found: {} };
    if (status < 200 || status >= 300) return { ok: false, failure: status };
    const d = (data as { data?: { email?: string | null; score?: number | null } } | null)?.data;
    const email = (d?.score ?? 0) >= 50 ? cleanFoundField('email', d?.email) : null;
    return { ok: true, found: email ? { email } : {} };
  } catch (err) {
    return { ok: false, failure: failureOf(err) };
  }
}

/**
 * Apollo people/match by name + organization domain, WITHOUT personal-email or phone reveal.
 * Consumes Apollo credits when a person is matched. A match whose first name differs from the typed one is ignored.
 * Phone: prefers a mobile number and uses raw_number, exactly like apollo-phone-webhook.
 */
export async function apolloMatchPerson(domain: string, first: string, last: string, apiKey: string): Promise<LookupResult> {
  try {
    const { status, data } = await callJson('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify({ first_name: first, last_name: last, domain, reveal_personal_emails: false }),
    }, 8000);
    if (status < 200 || status >= 300) return { ok: false, failure: status };
    const person = (data as {
      person?: {
        first_name?: string | null; email?: string | null; linkedin_url?: string | null;
        phone_numbers?: { raw_number?: string | null; type_cd?: string | null }[];
      };
    } | null)?.person;
    if (!person) return { ok: true, found: {} };
    if (person.first_name && first && person.first_name.trim().toLowerCase() !== first.trim().toLowerCase()) {
      return { ok: true, found: {} };
    }
    const found: FoundFields = {};
    const phones = person.phone_numbers ?? [];
    const chosen = phones.find((p) => p.type_cd === 'mobile') ?? phones[0];
    const email = cleanFoundField('email', person.email);
    const phone = cleanFoundField('phone', chosen?.raw_number);
    const linkedin = cleanFoundField('linkedin_url', person.linkedin_url);
    if (email) found.email = email;
    if (phone) found.phone = phone;
    if (linkedin) found.linkedin_url = linkedin;
    return { ok: true, found };
  } catch (err) {
    return { ok: false, failure: failureOf(err) };
  }
}
