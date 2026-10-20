// Import-free rules for bounded common-format guesses. No provider or database access.
import { patternGuess, type DomainPattern, type PatternSample } from './domainPattern.ts';
import type { MailProvider } from './dnsLookup.ts';
export const PEOPLE_RESERVE_MS = 25_000;
export const PEOPLE_LOOKUP_FLOOR_MS = 15_000;
export const GUESS_TOTAL_MS = 20_000;
export const GUESS_CHECK_TIMEOUT_MS = 12_000;

/** One wall-clock allowance shared by all guess paths and later domain batches for a lead. */
export class GuessBudget {
  private deadline: number | null = null;
  get exhausted(): boolean { return this.deadline !== null && Date.now() >= this.deadline; }
  constructor(private left: () => number, private hasPeople: () => boolean) {}
  timeout(maxMs = GUESS_CHECK_TIMEOUT_MS): number {
    if (this.deadline === null) this.deadline = Date.now() + GUESS_TOTAL_MS;
    const remaining = this.deadline - Date.now();
    const reserve = this.hasPeople() ? PEOPLE_RESERVE_MS + PEOPLE_LOOKUP_FLOOR_MS : 25_000;
    return Math.max(0, Math.min(maxMs, remaining, this.left() - reserve));
  }
  async run(jobs: ((timeoutMs: number) => Promise<void>)[]): Promise<void> {
    let index = 0;
    let failed = false;
    let failure: unknown;
    const consume = async () => {
      while (!failed && index < jobs.length) {
        const timeout = this.timeout();
        if (timeout < 1) return;
        try { await jobs[index++]!(timeout); }
        catch (error) { failed = true; failure = error; }
      }
    };
    await Promise.all([consume(), consume(), consume()]);
    if (failed) throw failure;
  }
}
export const CATCH_ALL_GUESS_LABEL = 'Guess, the mail server accepts any address so it cannot be confirmed';
export const COMMON_GUESS_LABEL = 'Guessed from common formats and confirmed by our email checker, check it';

/** First given name, complete surname; retain ASCII letters after removing accents and name punctuation. */
export function commonEmailCandidates(first: string, last: string, domain: string): string[] {
  const part = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s'’.-]/g, '');
  const f = part(first.trim().split(/\s+/)[0] ?? '');
  const l = part(last.trim());
  const d = domain.trim().toLowerCase();
  if (!/^[a-z]+$/.test(f) || !/^[a-z]+$/.test(l) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return [];
  return [...new Set([`${f}.${l}`, f, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`])]
    .filter((local) => local.length <= 64).map((local) => `${local}@${d}`).slice(0, 5);
}

/** Existing admission rules receive only the time left after the people floor. */
export function optionalPeopleBudget(leftMs: number, hasPeople: boolean): number {
  return Math.max(0, leftMs - (hasPeople ? PEOPLE_RESERVE_MS : 0));
}

/** Shared by inferred and common formats: no repeated address, six checks per lead, five per domain. */
export class GuessChecks {
  readonly catchAll = new Set<string>();
  readonly blocked = new Set<string>();
  readonly attempted = new Set<string>();
  private counts = new Map<string, number>();
  private stopped = false;
  constructor(private maxChecks = 6) {}
  canCheck(email: string, _legacy = false): boolean {
    const key = email.toLowerCase();
    const d = key.split('@')[1] ?? '';
    return !this.stopped && !this.catchAll.has(d) && !this.blocked.has(d) && !this.attempted.has(key)
      && this.attempted.size < this.maxChecks && (this.counts.get(d) ?? 0) < 5;
  }
  claim(email: string): boolean {
    if (!this.canCheck(email)) return false;
    this.record(email, null, '');
    return true;
  }
  record(email: string, status: string | null, reason: string): void {
    const key = email.toLowerCase();
    const d = key.split('@')[1] ?? '';
    if (!this.attempted.has(key)) {
      this.attempted.add(key);
      this.counts.set(d, (this.counts.get(d) ?? 0) + 1);
    }
    if (status !== null && reason === 'catch_all') this.catchAll.add(d);
    if (status === 'unverifiable') this.blocked.add(d);
  }
  stopWorker(): void { this.stopped = true; }
  shouldStopPerson(status: string | null): boolean { return status === 'valid'; }
}

/** Fixed, bounded diagnostic sentences, with a cleaned person name. */
export function personEmailLine(name: string, details: string[]): string {
  const safe = name.replace(/[^\p{L}0-9 '’.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe}: no email found. ${details.length ? [...new Set(details)].join(' ') : 'No confirmed address was returned.'}`;
}

/** Inferred public format first, then the fixed common-format order, without duplicates. */
export function rankedEmailCandidates(first: string, last: string, domain: string, pattern: DomainPattern | null): string[] {
  const inferred = pattern ? patternGuess(pattern, { first, last }, domain) : null;
  return [...new Set([...(inferred ? [inferred] : []), ...commonEmailCandidates(first, last, domain)])];
}

export function providerGuessLine(domain: string, provider: MailProvider): string {
  const d = domain.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 80);
  if (provider === 'google') return `${d} uses Google Workspace, which does not allow mailboxes to be checked, so these are best guesses.`;
  if (provider === 'microsoft') return `${d} uses Microsoft 365, which does not allow mailboxes to be checked, so these are best guesses.`;
  if (provider === 'hosted') return `${d} uses a hosted mail provider. These addresses could not be confirmed, so these are best guesses.`;
  return `${d}: these addresses could not be confirmed, so these are best guesses.`;
}

/** These values are proposals only. This helper has no write or automatic-fill path. */
export function unverifiedEmailSuggestions(name: string, candidates: string[], provider: MailProvider) {
  return candidates.map((value, index) => ({ name, field: 'email' as const, value,
    guess_rank: index === 0 ? 'most_likely' as const : 'other' as const,
    label: `${index === 0 ? 'Most likely address' : 'Other possible format'} — Guess, unverified. ${providerGuessLine(value.split('@')[1] ?? '', provider)}` }));
}

/** Only source evidence supplies public addresses; model-only assertions never establish a format. */
export function groundedFormatSamples(domain: string, _answer: string, sourceEvidence: string[]): PatternSample[] {
  const emails = new Set<string>();
  for (const source of sourceEvidence.slice(0, 20)) {
    for (const m of source.slice(0, 20_000).matchAll(/[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      if (m[1].toLowerCase() === domain.toLowerCase()) emails.add(m[0].toLowerCase());
    }
  }
  return [...emails].slice(0, 40).map(email => ({ email, first: null, last: null }));
}
