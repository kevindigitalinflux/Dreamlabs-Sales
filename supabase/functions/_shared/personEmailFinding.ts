// Import-free rules for bounded common-format guesses. No provider or database access.
export const PEOPLE_RESERVE_MS = 25_000;
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

/** Leave the people floor after a full worker check; retain the old gate without pending people. */
export function canStartGuessCheck(leftMs: number, hasPeople: boolean, verifyTimeoutMs: number): boolean {
  return leftMs > (hasPeople ? PEOPLE_RESERVE_MS + verifyTimeoutMs : 25_000);
}

/** Shared by inferred and common formats: no repeated address, six checks per lead, five per domain. */
export class GuessChecks {
  readonly catchAll = new Set<string>();
  readonly attempted = new Set<string>();
  private counts = new Map<string, number>();
  private stopped = false;
  constructor(private maxChecks = 6) {}
  canCheck(email: string, legacy = false): boolean {
    const key = email.toLowerCase();
    const d = key.split('@')[1] ?? '';
    return !this.stopped && (legacy || !this.catchAll.has(d)) && !this.attempted.has(key)
      && this.attempted.size < this.maxChecks && (this.counts.get(d) ?? 0) < 5;
  }
  record(email: string, status: string | null, reason: string): void {
    const key = email.toLowerCase();
    const d = key.split('@')[1] ?? '';
    this.attempted.add(key);
    this.counts.set(d, (this.counts.get(d) ?? 0) + 1);
    if (status !== null && reason === 'catch_all') this.catchAll.add(d);
  }
  stopWorker(): void { this.stopped = true; }
  shouldStopPerson(status: string | null): boolean { return status === 'valid'; }
}

/** Fixed, bounded diagnostic sentences, with a cleaned person name. */
export function personEmailLine(name: string, details: string[]): string {
  const safe = name.replace(/[^\p{L}0-9 '’.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${safe}: no email found. ${details.length ? [...new Set(details)].join(' ') : 'No confirmed address was returned.'}`;
}
