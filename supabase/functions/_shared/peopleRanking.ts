// supabase/functions/_shared/peopleRanking.ts
// Ranks people a provider found (for example Hunter's company list) by how likely each is the decision maker, using
// their job title and, as a tie-breaker, the people a web search named. No imports on purpose: tested from src/lib.
// Ranking only ORDERS people: it never picks one person over another for the user, and never sets "use this one".

import { fullestPeople } from './personIdentity.ts';
/** The fields ranking reads. Every field is optional because provider data is untrusted. */
export interface RankablePerson { first_name?: unknown; last_name?: unknown; title?: unknown; seniority?: unknown }

/** A person named by a web search: data only, never saved on its own. */
export interface HintPerson { name: string; role: string | null }

const TOP = /\b(owner|co-?owner|founder|co-?founder|proprietor|managing director|chief executive|ceo|principal)\b/i;
const HIGH = /\b(director|partner|chief|coo|cfo|cto|president|chair(man|woman|person)?)\b/i;
const MID = /\b(head of|general manager|manager|lead)\b/i;

/** 0 to 5: owner/founder/MD level 3, director/partner/C-level 2, manager/head 1, plus Hunter seniority (executive 2, senior 1). */
export function decisionScore(title: unknown, seniority?: unknown): number {
  const t = typeof title === 'string' ? title.slice(0, 120) : '';
  const base = TOP.test(t) ? 3 : HIGH.test(t) ? 2 : MID.test(t) ? 1 : 0;
  const s = typeof seniority === 'string' ? seniority.toLowerCase() : '';
  return base + (s === 'executive' ? 2 : s === 'senior' ? 1 : 0);
}

function key(value: unknown): string {
  return typeof value === 'string' ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '') : '';
}

/**
 * Extra weight when the web search named this person: the same surname and the same first initial (2 when the web
 * search gave them a decision-maker role, else 1). Two people with the same surname and initial both get it.
 */
export function webHintScore(person: RankablePerson, hints: HintPerson[]): number {
  const first = key(person.first_name);
  const last = key(person.last_name);
  if (!first || !last) return 0;
  let best = 0;
  for (const h of hints) {
    const parts = h.name.trim().split(/\s+/);
    if (parts.length < 2) continue;
    if (key(parts[parts.length - 1]) !== last || key(parts[0])[0] !== first[0]) continue;
    best = Math.max(best, decisionScore(h.role) >= 2 ? 2 : 1);
  }
  return best;
}

/** People ordered by decisionScore plus webHintScore, highest first; ties keep their original order. */
export function rankPeople<T extends RankablePerson>(people: T[], hints: HintPerson[] = []): T[] {
  return fullestPeople(people, p => String(p.first_name ?? '') + ' ' + String(p.last_name ?? ''))
    .map((p, i) => ({ p, i, score: decisionScore(p.title, p.seniority) + webHintScore(p, hints) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.p);
}
