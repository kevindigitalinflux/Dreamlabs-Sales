import { CAP_LIMITS } from './deepFindLimits.ts';
/** Pure effort policy shared by confirmation, request validation and the queued engine. */
export const EFFORT_LEVELS = {
  low: { label: 'Low', hunter: 0, ai: 0, firecrawl: 0, explanation: 'Free steps only. Best for a first pass or large lists.' },
  medium: { label: 'Medium', hunter: 1, ai: 2, firecrawl: 1, explanation: 'Free steps first. Look deeper only if a verified email or named decision maker is missing.' },
  high: { label: 'High', hunter: 3, ai: 4, firecrawl: 1, explanation: 'Look deeper if email, decision maker or confirmed website is missing. Adds company web proof, Apollo and owner LinkedIn searches.' },
  extra_high: { label: 'Extra high', hunter: 6, ai: 8, firecrawl: 2, explanation: 'Try every step, even when details are complete. Best for a few high-value leads.' },
} as const;
export type Effort = keyof typeof EFFORT_LEVELS | 'custom';
export const EFFORT_RUN_LIMITS = CAP_LIMITS;
export const EFFORT_DAILY_LIMITS = { firecrawl: 100, scrapes: 100, checks: 150, places: 300, apollo: 100 } as const;
export function isEffort(value: unknown): value is Effort {
  return value === 'custom' || (typeof value === 'string' && Object.hasOwn(EFFORT_LEVELS, value));
}
/** Missing historical metadata always means today's numeric-cap behavior. */
export function effortPolicy(domains: unknown): Effort {
  const value = domains && typeof domains === 'object' ? (domains as Record<string, unknown>).effort : null;
  return isEffort(value) ? value : 'custom';
}
export function effortTotals(effort: Exclude<Effort, 'custom'>, count: number) {
  const n = Math.max(0, Math.floor(count));
  const level = EFFORT_LEVELS[effort];
  return { hunter: Math.min(n * level.hunter, EFFORT_RUN_LIMITS.hunter), ai: Math.min(n * level.ai, EFFORT_RUN_LIMITS.ai),
    firecrawl: Math.min(n * level.firecrawl, EFFORT_DAILY_LIMITS.firecrawl), scrapes: Math.min(n, EFFORT_DAILY_LIMITS.scrapes) };
}
export function deepPhaseDecision(effort: Effort, facts: { verifiedEmail: boolean; namedPerson: boolean; confirmedWebsite: boolean }) {
  const label = effort === 'custom' ? 'Custom' : EFFORT_LEVELS[effort].label;
  const missing = [!facts.verifiedEmail && 'a verified email', !facts.namedPerson && 'a named decision maker',
    effort === 'high' && !facts.confirmedWebsite && 'a confirmed website'].filter(Boolean);
  const run = effort === 'custom' || effort === 'extra_high' || (effort !== 'low' && missing.length > 0);
  const reason = effort === 'low' ? 'free steps only; deeper steps were skipped'
    : effort === 'custom' ? 'using your numeric run caps'
    : effort === 'extra_high' ? 'deeper steps run regardless of existing details'
    : run ? `free steps still lack ${missing.join(' and ')}, so deeper steps ran`
    : 'free steps found the required details, so deeper steps were skipped';
  return { run, line: `${label} effort: ${reason}.` };
}
export function hunterShortfall(left: number | null, requested: number): string | null {
  return left !== null && left < requested ? `Hunter has ${left} search${left === 1 ? '' : 'es'} left this month. Hunter steps stop when this allowance runs out; free steps continue.` : null;
}

/** The confirmation total and warning must use the same remaining Hunter allowance. */
export function hunterAllowanceLeft(allowance: { configured?: boolean; usedUp?: boolean; searchesLeft: number | null; creditsLeft: number | null } | null): number | null {
  return allowance?.configured === false || allowance?.usedUp ? 0 : allowance?.searchesLeft ?? allowance?.creditsLeft ?? null;
}
