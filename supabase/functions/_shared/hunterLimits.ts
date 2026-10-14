// supabase/functions/_shared/hunterLimits.ts
// Hunter limits: tells "this month's searches are used up" apart from "slow down" on a 429, reads Retry-After, and
// reads the free account endpoint (GET /v2/account). No imports on purpose: tested from src/lib. Only fixed strings
// and validated numbers ever reach output; provider text is matched, never passed on.

/** What a Hunter 429 means. */
export type Hunter429 = 'usage_exhausted' | 'rate_limited';

/** Longest Retry-After we are willing to wait for the one retry. */
export const MAX_RETRY_WAIT_MS = 3_000;
/** Wait used when a rate-limit 429 has no Retry-After header. */
export const DEFAULT_RETRY_WAIT_MS = 1_000;
/** Gap kept between Hunter calls (they run strictly one at a time). */
export const HUNTER_GAP_MS = 400;

const USAGE_WORDS = /usage|quota|limit_reached|credits?|plan|monthly|exhausted/i;

/**
 * Classifies a 429 body (parsed JSON or raw text, at most about 2 KB read). Hunter's error JSON is
 * `{"errors":[{"id":"usage_limit_reached"|"too_many_requests", ...}]}` (shape UNVERIFIED for every plan): an id or
 * text that talks about usage, quota, credits or the plan is `usage_exhausted`; anything else is `rate_limited`.
 */
export function classifyHunter429(body: unknown): Hunter429 {
  let text = '';
  if (typeof body === 'string') text = body.slice(0, 2_000);
  else if (typeof body === 'object' && body !== null) {
    const errors = (body as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      for (const e of errors.slice(0, 5)) {
        if (typeof e !== 'object' || e === null) continue;
        const r = e as Record<string, unknown>;
        for (const k of ['id', 'details', 'message']) if (typeof r[k] === 'string') text += ` ${(r[k] as string).slice(0, 300)}`;
      }
    }
  }
  if (/too_many_requests|rate[_ ]limit/i.test(text) && !/usage|quota|credits?|monthly/i.test(text)) return 'rate_limited';
  return USAGE_WORDS.test(text) ? 'usage_exhausted' : 'rate_limited';
}

/**
 * How long to wait before the one retry after a rate-limit 429: Retry-After in seconds (or an HTTP date), the default
 * when it is missing, or null when the wait would be longer than MAX_RETRY_WAIT_MS (then we do not retry).
 */
export function retryWaitMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === '') return DEFAULT_RETRY_WAIT_MS;
  const t = header.trim();
  let ms: number;
  if (/^\d{1,6}$/.test(t)) ms = Number(t) * 1000;
  else {
    const at = Date.parse(t);
    if (!Number.isFinite(at)) return DEFAULT_RETRY_WAIT_MS;
    ms = Math.max(0, at - now);
  }
  return ms <= MAX_RETRY_WAIT_MS ? ms : null;
}

/** What Hunter's account endpoint says is left this month (null when the field was missing or not a number). */
export interface HunterAccount {
  searchesUsed: number | null;
  searchesAvailable: number | null;
  searchesLeft: number | null;
  creditsLeft: number | null;
  /** Hunter's `data.reset_date` (YYYY-MM-DD) when it is a plain date, else null. Shape UNVERIFIED. */
  resetDate: string | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.floor(v) : null);

/**
 * Reads GET /v2/account defensively: `data.requests.searches.{used,available}` and, when present,
 * `data.requests.credits.{used,available}` (shapes UNVERIFIED). Null when nothing usable was found.
 */
export function parseHunterAccount(json: unknown): HunterAccount | null {
  const data = typeof json === 'object' && json !== null ? (json as { data?: unknown }).data : null;
  const requests = typeof data === 'object' && data !== null ? (data as { requests?: unknown }).requests : null;
  if (typeof requests !== 'object' || requests === null) return null;
  const pair = (k: string) => {
    const v = (requests as Record<string, unknown>)[k];
    const o = typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
    return { used: num(o.used), available: num(o.available) };
  };
  const s = pair('searches');
  const c = pair('credits');
  const left = (p: { used: number | null; available: number | null }) =>
    p.used !== null && p.available !== null ? Math.max(0, p.available - p.used) : null;
  const rawReset = (data as { reset_date?: unknown }).reset_date;
  const resetDate = typeof rawReset === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawReset) ? rawReset : null;
  const out = { searchesUsed: s.used, searchesAvailable: s.available, searchesLeft: left(s), creditsLeft: left(c), resetDate };
  return out.searchesLeft === null && out.creditsLeft === null && out.searchesUsed === null ? null : out;
}

/** True when the account has nothing left to search with (searches, or credits when that is all we know). */
export function hunterAccountEmpty(a: HunterAccount | null): boolean {
  if (!a) return false;
  if (a.searchesLeft !== null) return a.searchesLeft === 0;
  return a.creditsLeft === 0;
}

/** The fixed line shown when Hunter's monthly searches are used up. */
export const HUNTER_USAGE_EXHAUSTED_LINE = 'Hunter says this account\'s searches for the month are used up, so Hunter steps were skipped.';
/** The fixed line shown when Hunter asked us to slow down. */
export const HUNTER_RATE_LIMITED_LINE = 'Hunter asked us to slow down, so some Hunter steps were skipped. Try again in a few minutes.';

/** "Hunter: 12 searches left this month." (or the credits, or null when nothing is known). */
export function hunterAccountLine(a: HunterAccount | null): string | null {
  if (!a) return null;
  if (a.searchesLeft !== null) return `Hunter: ${a.searchesLeft} ${a.searchesLeft === 1 ? 'search' : 'searches'} left this month.`;
  if (a.creditsLeft !== null) return `Hunter: ${a.creditsLeft} ${a.creditsLeft === 1 ? 'credit' : 'credits'} left this month.`;
  return null;
}
