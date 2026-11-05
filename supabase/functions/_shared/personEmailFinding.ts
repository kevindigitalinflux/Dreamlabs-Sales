// Import-free rules for bounded common-format guesses. No provider or database access.
import { patternGuess, type DomainPattern, type PatternSample } from './domainPattern.ts';
import { isOwnerRole } from './deepFindSuggestions.ts';
import { displayPersonKey } from './personIdentity.ts';
import type { MailProvider } from './dnsLookup.ts';
export const PEOPLE_RESERVE_MS = 25_000;
export const PEOPLE_LOOKUP_FLOOR_MS = 15_000;
export const GUESS_TOTAL_MS = 105_000;
export const GUESS_CHECK_TIMEOUT_MS = 33_000;

/** One wall-clock allowance shared by all guess paths and later domain batches for a lead. */
export class GuessBudget {
  private deadline: number | null = null;
  get exhausted(): boolean { return this.deadline !== null && Date.now() >= this.deadline; }
  constructor(private left: () => number, private hasPeople: () => boolean) {}
  /** Shared waiting and call allowance, retaining the people reserve across gate waits. */
  timeLeft(): number {
    if (this.deadline === null) this.deadline = Date.now() + GUESS_TOTAL_MS;
    const remaining = this.deadline - Date.now();
    // The 25-second people reserve already exceeds its 15-second floor; do not add the same reserve twice.
    const reserve = this.hasPeople() ? Math.max(PEOPLE_RESERVE_MS, PEOPLE_LOOKUP_FLOOR_MS) : 25_000;
    return Math.max(0, Math.min(remaining, this.left() - reserve));
  }
  timeout(maxMs = GUESS_CHECK_TIMEOUT_MS): number {
    const available = Math.min(maxMs, this.timeLeft());
    return maxMs === GUESS_CHECK_TIMEOUT_MS && available < GUESS_CHECK_TIMEOUT_MS ? 0 : available;
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
  readonly timedOut = new Set<string>();
  private known = new Set<string>();
  private timeoutAddresses = new Set<string>();
  private timeoutCounts = new Map<string, number>();
  private unverifiableAddresses = new Set<string>();
  private unverifiableCounts = new Map<string, number>();
  private counts = new Map<string, number>();
  private stopped = false;
  constructor(private maxChecks = 6) {}
  /** Remaining admission slots, preserving the lead and domain allowances. */
  remaining(domain: string): number { return Math.max(0, Math.min(this.maxChecks - this.attempted.size, 5 - (this.counts.get(domain) ?? 0))); }
  canCheck(email: string, _legacy = false): boolean {
    const key = email.toLowerCase();
    const d = key.split('@')[1] ?? '';
    return !this.stopped && !this.catchAll.has(d) && !this.blocked.has(d) && !this.attempted.has(key) && !this.known.has(key)
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
    if(['bounced_hard','previously_replied'].includes(reason)) {
      if(this.attempted.delete(key))this.counts.set(d,Math.max(0,(this.counts.get(d)??0)-1));
      this.known.add(key);return;
    }
    // Admission is not an attempt when the gate never dispatched the address.
    if (['waiting_for_domain', 'lead_time_exhausted', 'hosted_unverifiable'].includes(reason)) {
      if (this.attempted.delete(key)) this.counts.set(d, Math.max(0, (this.counts.get(d) ?? 0) - 1));
      if (reason === 'hosted_unverifiable') this.blocked.add(d);
      return;
    }
    if (!this.attempted.has(key)) {
      this.attempted.add(key);
      this.counts.set(d, (this.counts.get(d) ?? 0) + 1);
    }
    if (reason === 'timeout' && !this.timeoutAddresses.has(key)) {
      this.timeoutAddresses.add(key);
      const count = (this.timeoutCounts.get(d) ?? 0) + 1;
      this.timeoutCounts.set(d, count);
      if (count >= 1) { this.blocked.add(d); this.timedOut.add(d); }
    }
    if (status !== null && reason === 'catch_all') this.catchAll.add(d);
    if (status === 'unverifiable') {
      if (!this.unverifiableAddresses.has(key)) {
        this.unverifiableAddresses.add(key);
        this.unverifiableCounts.set(d, (this.unverifiableCounts.get(d) ?? 0) + 1);
      }
      if (reason === 'provider_blocks_checks' || (this.unverifiableCounts.get(d) ?? 0) >= 2) this.blocked.add(d);
    }
  }
  /** Preserve Hunter credit suppression while allowing another free checker attempt. */
  hasUnverifiable(domain: string): boolean { return this.unverifiableCounts.has(domain.toLowerCase()); }
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
  if (provider === 'google') return `${d} uses Google Workspace, where checks are less reliable, so treat any address as a best guess.`;
  if (provider === 'microsoft') return `${d} uses Microsoft 365, where checks are less reliable, so treat any address as a best guess.`;
  if (provider === 'hosted') return `${d} uses a hosted mail provider. These addresses could not be confirmed, so these are best guesses.`;
  return `${d}: these addresses could not be confirmed, so these are best guesses.`;
}

/** These values are proposals only. This helper has no write or automatic-fill path. */
export function unverifiedEmailSuggestions(name: string, candidates: string[], provider: MailProvider, includeProvider = true) {
  return candidates.map((value, index) => ({ name, field: 'email' as const, value,
    guess_rank: index === 0 ? 'most_likely' as const : 'other' as const,
    label: `${index === 0 ? 'Most likely address' : 'Other possible format'} — Guess, unverified.${includeProvider ? ' ' + providerGuessLine(value.split('@')[1] ?? '', provider) : ''}` }));
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

/** Stable owner/decision-maker ordering for the domain's first canary candidate. */
export function prioritiseCheckPeople<T extends { first: string; last: string; title?: string | null }>(people: T[], owners: unknown[]): T[] {
  return [...people].sort((a, b) => checkPersonPriority(a, owners) - checkPersonPriority(b, owners));
}

/** Owners first, then decision makers, then other named people. */
export function checkPersonPriority(person: { first: string; last: string; title?: string | null }, owners: unknown[]): number {
  const names = new Set(owners.filter((name): name is string => typeof name === 'string').map(displayPersonKey));
  return names.has(displayPersonKey(person.first + ' ' + person.last)) ? 0 : isOwnerRole(person.title) ? 1 : 2;
}
