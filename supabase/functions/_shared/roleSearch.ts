import { judgeRoleHit, roleLadder, roleQuery, type RoleCandidate } from './roleSearchRules.ts';
import { displayPersonKey } from './personIdentity.ts';
import type { SearchProvider } from './searchProvider.ts';

export interface RoleSearchResult { people: RoleCandidate[]; searches: number; via: ('searxng' | 'gemini')[]; stopped?: 'time' | 'limit' | 'cap' | 'failed' }

/** Stop at the first successful rung, before a fourth search or a third person. */
export async function findRolePeople(input: { company: string; registeredName?: string | null; city?: string | null; profile: { targetRoles?: unknown; fallbackRoles?: unknown } | null; provider: SearchProvider; timeLeftMs: () => number }): Promise<RoleSearchResult> {
  const out: RoleSearchResult = { people: [], searches: 0, via: [] };
  if (!input.company.trim()) return out;
  for (const rung of roleLadder(input.profile)) {
    if (out.searches >= 3) break;
    if (input.timeLeftMs() < 20_000) { out.stopped = 'time'; break; }
    out.searches++;
    const result = await input.provider.search(roleQuery({ company: input.company, city: input.city, roles: rung.roles }));
    if (!result.ok) {
      if (result.why !== 'none') { out.stopped = result.why; break; }
      continue;
    }
    out.via.push(result.via);
    for (const hit of result.hits.slice(0, 8)) {
      const judged = judgeRoleHit(hit, input, rung);
      if (!judged.ok || out.people.some(person => displayPersonKey(`${person.first} ${person.last}`) === displayPersonKey(`${judged.person.first} ${judged.person.last}`))) continue;
      out.people.push(judged.person);
      if (out.people.length === 2) break;
    }
    if (out.people.length) break;
  }
  return out;
}

type Contact = { id: string; first_name?: unknown; last_name?: unknown; title?: unknown; linkedin_url?: unknown; dismissed_at?: unknown };
/** One person key yields one live contact; existing values and dismissed people always win. */
export function roleContactPlan(person: Pick<RoleCandidate, 'first' | 'last' | 'title' | 'linkedinUrl'>, contacts: Contact[], scope: { leadId: string; creatorId: string }): { kind: 'skip' } | { kind: 'merge'; contactId: string; patch: Record<string, string> } | { kind: 'insert'; row: Record<string, unknown> } {
  const key = displayPersonKey(`${person.first} ${person.last}`);
  const matches = contacts.filter(contact => displayPersonKey(`${contact.first_name ?? ''} ${contact.last_name ?? ''}`) === key);
  if (matches.length > 1 || matches[0]?.dismissed_at) return { kind: 'skip' };
  if (matches[0]) {
    const patch: Record<string, string> = {};
    if (!String(matches[0].title ?? '').trim() && person.title) patch.title = person.title;
    if (!String(matches[0].linkedin_url ?? '').trim() && person.linkedinUrl) patch.linkedin_url = person.linkedinUrl;
    return { kind: 'merge', contactId: matches[0].id, patch };
  }
  return { kind: 'insert', row: { lead_id: scope.leadId, created_by: scope.creatorId, source: 'role_search', kind: 'person', first_name: person.first, last_name: person.last, title: person.title, linkedin_url: person.linkedinUrl, include_in_sequences: false } };
}

/** A foreign profile never supplies roles; the only-profile fallback is org-scoped. */
export function chooseRoleProfile(profiles: { id: string; org_id: string; target_roles?: unknown; fallback_roles?: unknown }[], orgId: string, icpId: string | null): { targetRoles: unknown; fallbackRoles: unknown } | null {
  const own = profiles.filter(profile => profile.org_id === orgId);
  const profile = own.find(item => item.id === icpId) ?? (own.length === 1 ? own[0] : null);
  return profile ? { targetRoles: profile.target_roles ?? [], fallbackRoles: profile.fallback_roles ?? [] } : null;
}

/** Stable partition retains existing order within each source group. */
export function prioritizeRolePeople<T extends { first: string; last: string }>(people: T[], accepted: { first: string; last: string }[]): T[] {
  const keys = new Set(accepted.map(person => displayPersonKey(`${person.first} ${person.last}`)));
  return [...people].sort((a, b) => Number(keys.has(displayPersonKey(`${b.first} ${b.last}`))) - Number(keys.has(displayPersonKey(`${a.first} ${a.last}`))));
}

/** Apply only when adding officers, after role discovery has finished. */
export function officersForRoleSearch<T>(officers: T[], roleHit: boolean): T[] { return roleHit ? officers.slice(0, 3) : officers; }

/** Exact user-facing summary; never emitted as provider logging. */
export function roleSearchLine(result: Pick<RoleSearchResult, 'people' | 'via' | 'stopped'>): string {
  const line = result.people.length ? `Role search: found ${result.people.length} (${result.people.map(person => `${person.first} ${person.last}, ${person.title}`).join('; ')}).`
    : result.stopped === 'limit' ? 'Role search: skipped, the web search allowance for today is used up.'
    : result.stopped === 'cap' ? 'Role search: skipped, the AI call cap was reached.'
    : result.stopped === 'time' ? 'Role search: ran out of time.' : 'Role search: nobody in the target roles was found.';
  return line + (result.via.includes('gemini') ? ' Used the backup search.' : '');
}
