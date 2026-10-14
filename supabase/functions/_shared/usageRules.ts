// supabase/functions/_shared/usageRules.ts
// Rules for the shared lookup worker's usage limits. Import-free on purpose: used by edge functions (Deno) and by
// the browser app, and tested from src/lib. Defaults here MUST match the seed rows in migration 059_usage_quotas.sql.

export type UsageResource = 'worker_scrape' | 'worker_verify' | 'worker_fetch';

export const USAGE_RESOURCES: readonly UsageResource[] = ['worker_scrape', 'worker_verify', 'worker_fetch'];

export const USAGE_TEXT: Record<UsageResource, { label: string; noun: string }> = {
  worker_scrape: { label: 'Site scrapes', noun: 'site scrapes' },
  worker_verify: { label: 'Email checks', noun: 'email checks' },
  worker_fetch: { label: 'Page fetches', noun: 'page fetches' },
};

export const USAGE_DEFAULTS: Record<UsageResource, { orgLimit: number; globalLimit: number }> = {
  worker_scrape: { orgLimit: 100, globalLimit: 400 },
  worker_verify: { orgLimit: 150, globalLimit: 300 },
  worker_fetch: { orgLimit: 300, globalLimit: 1000 },
};

export const MAX_ORG_LIMIT = 5000;
/** Fraction of an allowance used from which the meter turns amber. */
export const WARNING_FRACTION = 0.8;

const LONDON = 'Europe/London';

export interface UsageRow {
  resource: UsageResource;
  used: number;
  limit: number;
  globalUsed: number;
  globalLimit: number;
  /** ISO timestamp of the next London midnight. */
  resetsAt: string;
}

export type UsageState = 'ok' | 'warning' | 'full' | 'shared_full';

// ---------- London day maths ----------
interface Wall { y: number; m: number; d: number; h: number; mi: number; s: number }

function londonWall(at: Date): Wall {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

/** Milliseconds London is ahead of UTC at this instant (3_600_000 in summer, 0 in winter). */
function londonOffsetMs(at: Date): number {
  const w = londonWall(at);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(at.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The London calendar date of an instant, as YYYY-MM-DD (the day key used by the database). */
export function londonDay(now: Date): string {
  const w = londonWall(now);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

/** The next instant at which the London date changes. Correct on 23-hour and 25-hour days. */
export function nextLondonMidnight(now: Date): Date {
  const w = londonWall(now);
  const wallMidnight = Date.UTC(w.y, w.m - 1, w.d + 1, 0, 0, 0);
  let guess = wallMidnight - londonOffsetMs(new Date(wallMidnight));
  guess = wallMidnight - londonOffsetMs(new Date(guess));
  return new Date(guess);
}

// ---------- Wording ----------
export function formatResetsIn(now: Date, resetsAt: Date): string {
  const ms = resetsAt.getTime() - now.getTime();
  if (ms < 60_000) return 'in less than a minute';
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

export function formatResetLine(now: Date, resetsAt: Date): string {
  return `Resets at 00:00 UK time (${formatResetsIn(now, resetsAt)})`;
}

/** "18 Oct" from a provider's renewal date (YYYY-MM-DD or an ISO timestamp); null when it is not a date. */
export function formatRenewalDate(iso: string | null | undefined): string | null {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ---------- State ----------
export function remaining(row: UsageRow): number {
  return Math.max(0, Math.min(row.limit - row.used, row.globalLimit - row.globalUsed));
}

export function usageState(row: UsageRow): UsageState {
  if (row.limit - row.used <= 0) return 'full';
  if (row.globalLimit - row.globalUsed <= 0) return 'shared_full';
  if (row.used >= row.limit * WARNING_FRACTION) return 'warning';
  if (row.globalUsed >= row.globalLimit * WARNING_FRACTION) return 'warning';
  return 'ok';
}

const SEVERITY: Record<UsageState, number> = { ok: 0, warning: 1, full: 2, shared_full: 2 };

/** The allowance closest to running out: most severe state first, then the smallest share left. */
export function tightestAllowance(rows: UsageRow[]): UsageRow | null {
  if (rows.length === 0) return null;
  const share = (r: UsageRow) => remaining(r) / Math.max(1, r.limit);
  return [...rows].sort((a, b) => SEVERITY[usageState(b)] - SEVERITY[usageState(a)] || share(a) - share(b))[0] ?? null;
}

export function chipText(row: UsageRow): string {
  const label = USAGE_TEXT[row.resource].label;
  const state = usageState(row);
  if (state === 'full') return `${label}: limit reached`;
  if (state === 'shared_full') return `${label}: shared allowance used up`;
  return `${label}: ${remaining(row)} left`;
}

/** The chip text for narrow screens: still in words, no resource name ("40 left", "Limit reached"). */
export function shortChipText(row: UsageRow): string {
  const state = usageState(row);
  if (state === 'full') return 'Limit reached';
  if (state === 'shared_full') return 'Shared pool used up';
  return `${remaining(row)} left`;
}

export function stateLine(row: UsageRow): string {
  const state = usageState(row);
  if (state === 'full') return `Limit reached (${row.limit} a day)`;
  if (state === 'shared_full') return 'Shared worker allowance used up today';
  return `${row.used} of ${row.limit} used today`;
}

export type RefusalReason = 'org_limit' | 'shared_pool' | 'bad_input' | 'error';

/** The one line a feature shows when it skips a worker step because the allowance did not allow it. */
export function refusalLine(reason: RefusalReason, resource: UsageResource, limit?: number): string {
  const noun = USAGE_TEXT[resource].noun;
  if (reason === 'org_limit') {
    const count = typeof limit === 'number' ? `${limit} ` : '';
    return `Extra lookup skipped: your organisation has used its ${count}${noun} for today (resets at 00:00 UK time).`;
  }
  if (reason === 'shared_pool') return `Extra lookup skipped: the shared worker allowance for ${noun} is used up for today (resets at 00:00 UK time).`;
  return 'Extra lookup skipped: the usage check could not be completed.';
}

// ---------- Parsing (fail closed) ----------
export type ReserveResult =
  | { ok: true; day: string; used: number; limit: number }
  | { ok: false; reason: RefusalReason; limit?: number };

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Reads usage_reserve's JSON. Anything unexpected becomes a refusal: a broken check never lets a call through. */
export function parseReserve(raw: unknown): ReserveResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'error' };
  const r = raw as Record<string, unknown>;
  if (r.ok === true) {
    if (typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) && isCount(r.used) && isCount(r.limit)) {
      return { ok: true, day: r.day, used: r.used, limit: r.limit };
    }
    return { ok: false, reason: 'error' };
  }
  if (r.ok === false && (r.reason === 'org_limit' || r.reason === 'shared_pool' || r.reason === 'bad_input')) {
    return isCount(r.limit) ? { ok: false, reason: r.reason, limit: r.limit } : { ok: false, reason: r.reason };
  }
  return { ok: false, reason: 'error' };
}

/** Reads usage_snapshot's JSON array into rows ordered like USAGE_RESOURCES. Malformed rows are dropped. */
export function parseSnapshot(raw: unknown): UsageRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: UsageRow[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const resource = USAGE_RESOURCES.find((k) => k === r.resource);
    if (!resource || !isCount(r.used) || !isCount(r.limit) || !isCount(r.global_used) || !isCount(r.global_limit)) continue;
    if (typeof r.resets_at !== 'string' || Number.isNaN(new Date(r.resets_at).getTime())) continue;
    rows.push({ resource, used: r.used, limit: r.limit, globalUsed: r.global_used, globalLimit: r.global_limit, resetsAt: r.resets_at });
  }
  return rows.sort((a, b) => USAGE_RESOURCES.indexOf(a.resource) - USAGE_RESOURCES.indexOf(b.resource));
}

/** An admin's typed limit: a whole number from 0 to 5000, otherwise null. */
export function parseLimitInput(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n <= MAX_ORG_LIMIT ? n : null;
}
