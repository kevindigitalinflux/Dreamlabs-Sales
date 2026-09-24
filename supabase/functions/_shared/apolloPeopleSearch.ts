// supabase/functions/_shared/apolloPeopleSearch.ts
import { fetchWithTimeout } from './fetchWithTimeout.ts';

const DECISION_MAKER_SENIORITIES = ['owner', 'founder', 'c_suite', 'partner', 'director'];

export interface ApolloPersonCandidate {
  apolloPersonId: string;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
}

/**
 * Apollo's people search (0 credits — confirmed against Apollo's own
 * endpoint-essentials table, 2026-09-24). Returns only an obfuscated last
 * name and title — never contact info, that requires the separate paid
 * revealApolloPerson() call below. per_page: 1 — this feature only ever
 * shows the single best candidate per lead.
 */
export async function searchApolloDecisionMaker(domain: string, apiKey: string): Promise<ApolloPersonCandidate | null> {
  try {
    const params = new URLSearchParams();
    params.append('q_organization_domains_list[]', domain);
    for (const seniority of DECISION_MAKER_SENIORITIES) params.append('person_seniorities[]', seniority);
    params.append('per_page', '1');
    const res = await fetchWithTimeout('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Api-Key': apiKey },
      body: params.toString(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { people?: { id?: string; first_name?: string; last_name_obfuscated?: string; title?: string | null }[] };
    const top = data.people?.[0];
    if (!top?.id) return null;
    return {
      apolloPersonId: top.id,
      firstName: top.first_name ?? null,
      lastNameObfuscated: top.last_name_obfuscated ?? null,
      title: top.title ?? null,
    };
  } catch {
    return null;
  }
}

export interface ApolloRevealResult {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

/**
 * Apollo's people/match with an explicit, already-consented reveal request.
 * Costs real Apollo credits (1 for email/demographics if found, +8 more if
 * a mobile phone is actually returned via the webhook — confirmed against
 * Apollo's docs, 2026-09-24). When revealPhone is true, the phone number is
 * NEVER in this response — it arrives later at webhookUrl. This function
 * only returns the synchronous parts (name, email).
 */
export async function revealApolloPerson(
  personId: string,
  apiKey: string,
  opts: { revealEmail: boolean; revealPhone: boolean; webhookUrl?: string },
): Promise<ApolloRevealResult | null> {
  try {
    const body: Record<string, unknown> = { id: personId };
    if (opts.revealEmail) body.reveal_personal_emails = true;
    if (opts.revealPhone) {
      body.reveal_phone_number = true;
      body.webhook_url = opts.webhookUrl;
    }
    const res = await fetchWithTimeout('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
      body: JSON.stringify(body),
    }, 8000);
    if (!res.ok) return null;
    const data = await res.json() as { person?: { first_name?: string; last_name?: string; email?: string } };
    if (!data.person) return null;
    return {
      firstName: data.person.first_name ?? null,
      lastName: data.person.last_name ?? null,
      email: data.person.email ?? null,
    };
  } catch {
    return null;
  }
}
