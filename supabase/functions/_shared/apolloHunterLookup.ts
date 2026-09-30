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

/** "Alan Christopher CLARK" -> { first: "Alan", last: "CLARK" }; null unless there are at least two name parts. */
export function splitPersonName(fullName: string): { first: string; last: string } | null {
  const parts = fullName.replace(/^(mr|mrs|ms|miss|dr)\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { first: parts[0]!, last: parts[parts.length - 1]! };
}

/**
 * Hunter email-finder — the address of one NAMED person at a domain (e.g. the
 * owner found by Companies House), unlike domain-search which returns whoever
 * Hunter has seen at the company. Only trusts a reasonably confident match
 * (score >= 50). Returns null on no match, a single-word name, or any error;
 * never throws, never writes anywhere.
 */
export async function lookupHunterOwnerEmail(website: string | null, ownerName: string, apiKey: string): Promise<string | null> {
  const domain = bareDomain(website ?? '');
  const name = splitPersonName(ownerName);
  if (!domain || !name) return null;
  try {
    const params = new URLSearchParams({ domain, first_name: name.first, last_name: name.last, api_key: apiKey });
    const res = await fetchWithTimeout(`https://api.hunter.io/v2/email-finder?${params}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { email?: string | null; score?: number | null } };
    const email = data.data?.email;
    return email && (data.data?.score ?? 0) >= 50 ? email : null;
  } catch {
    return null;
  }
}

const DECISION_MAKER_TITLE_PATTERN = /owner|founder|chief|ceo|coo|cfo|cto|president|managing director|director/i;

interface HunterEmailEntry {
  value: string;
  confidence: number;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  linkedin?: string | null;
}

export interface HunterDecisionMakerCandidate {
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string;
  linkedinUrl: string | null;
}

/**
 * Hunter domain-search, but scored for "most likely decision-maker" instead
 * of "highest confidence" — prefers seniority: 'executive', then a title
 * matching an owner/founder/C-suite/director pattern, then falls back to
 * confidence. Hunter already includes name+position+seniority per email in
 * this same call (unlike lookupHunterEmail above, which discards them) — no
 * extra request, no extra cost.
 */
export async function findHunterDecisionMaker(website: string | null, apiKey: string): Promise<HunterDecisionMakerCandidate | null> {
  const domain = bareDomain(website ?? '');
  if (!domain) return null;
  try {
    const res = await fetchWithTimeout(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json() as { data?: { emails?: HunterEmailEntry[] } };
    const emails = data.data?.emails ?? [];
    if (emails.length === 0) return null;
    const ranked = [...emails].sort((a, b) => {
      const seniorityScore = (e: HunterEmailEntry) => (e.seniority === 'executive' ? 2 : e.seniority === 'senior' ? 1 : 0);
      const titleScore = (e: HunterEmailEntry) => (e.position && DECISION_MAKER_TITLE_PATTERN.test(e.position) ? 1 : 0);
      const aScore = seniorityScore(a) * 10 + titleScore(a) * 5;
      const bScore = seniorityScore(b) * 10 + titleScore(b) * 5;
      if (aScore !== bScore) return bScore - aScore;
      return b.confidence - a.confidence;
    });
    const top = ranked[0]!;
    return { firstName: top.first_name ?? null, lastName: top.last_name ?? null, title: top.position ?? null, email: top.value, linkedinUrl: top.linkedin || null };
  } catch {
    return null;
  }
}
