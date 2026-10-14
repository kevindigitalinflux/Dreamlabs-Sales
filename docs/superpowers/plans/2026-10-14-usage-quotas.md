# Usage and Quotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meter and hard-cap use of the shared lookup worker per organisation and worker-wide, enforced atomically in the database, with a top-bar usage meter and an admin limits card.

**Architecture:** Three small Postgres tables plus two service-role-only functions (`usage_reserve`, `usage_refund`) that lock a worker-wide counter row then the organisation's row in one transaction, so no concurrent calls can overshoot either cap. One member-readable function (`usage_snapshot`) feeds a `useUsage` hook and a `UsageMeter` chip in the top bar. All rules that both server and browser need (resources, defaults, London-day maths, states, wording, response parsing) live in one import-free module, `supabase/functions/_shared/usageRules.ts`, tested from `src/lib`.

**Tech Stack:** Postgres (Supabase, migration 059), Deno edge-function shared code, React 19 + TypeScript strict + Tailwind v4, vitest (node environment, `.ts` tests only).

**Spec:** `docs/superpowers/specs/2026-10-14-usage-quotas-design.md` (read it first; this plan lists the deliberate changes from it below).

## Global Constraints

- Resources and defaults (verbatim from the spec): `worker_scrape` "Site scrapes" 100 per organisation / 400 worker-wide per day; `worker_verify` "Email checks" 150 / 300; `worker_fetch` "Page fetches" 300 / 1,000. A deep scrape costs 3 units; a cache hit costs 0 (no reserve call).
- Days run 00:00 to 00:00 **Europe/London**; the UI says "resets at 00:00 UK time (in 6h 12m)".
- Limits: per-organisation override 0 to 5,000; the worker-wide cap always wins.
- **Fail closed:** any error in the quota check means "not allowed".
- `usage_reserve` and `usage_refund` are granted to `service_role` only; `usage_snapshot` to `authenticated` and `service_role`, and it starts with an `is_org_member` check. No client write to counters, global counters or resources.
- Chip and list text always state the situation in words; colour only reinforces. Amber from 80% used, red at the cap or when the shared allowance is used up.
- Any hook that may be mounted twice uses a per-instance realtime channel name via `useId()` (CLAUDE.md rule).
- Migration number is **059**, applied through the Supabase MCP only after Kevin has seen the SQL (project ref `wgomksxelyfkzepbnkdd`).
- Windows line-ending noise: stage explicit paths only, never `git add .`; Kevin pushes himself (`git push origin HEAD:main`). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

**Deliberate changes from the spec** (each is simpler or stricter):
1. No `usage_provider_cache` table. The meter reuses the existing `hunter_account` action of `run-deep-find` (already rate-limited at 120 a day per user) and the existing `fetchHunterAllowance`; it is called only when the panel is first opened, and Task 5 adds the renewal date.
2. `usage_refund` **refuses** (returns false, changes nothing) when asked to refund more than the organisation used that day, instead of flooring at 0.
3. "Hidden for users with no worker access" is dropped: there is no such role today, so every organisation member sees the meter.
4. The warning state also triggers when the **shared** pool is 80% used, so people see a squeeze before it bites.

## Review Focus

- Many simultaneous reserves at the boundary (limit N, 40 parallel calls) must give exactly N successes and a counter of exactly N. Owned by Task 3.
- 25-hour and 23-hour London days (clock changes on 2026-10-25 and 2027-03-28): the day key and the reset time must stay correct. Owned by Task 1.
- A limit of 0, or an organisation limit above the worker-wide cap: reservations are refused with the right reason (`org_limit` first, otherwise `shared_pool`). Owned by Tasks 1 and 3.
- Refund edge cases: wrong day, more than used, bad units never change counters. Owned by Task 3.
- The snapshot call failing or returning junk: the meter says "Usage unavailable" and never shows a wrong number or crashes; a failed refetch after a good load keeps the last numbers. Owned by Tasks 1 and 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/usageRules.ts` (create) | Import-free rules: resources, defaults, London day maths, state, wording, parsing |
| `src/lib/usageRules.test.ts` (create) | Tests for the rules module |
| `supabase/migrations/059_usage_quotas.sql` (create) | Tables, RLS, grants, trigger, three functions, realtime |
| `supabase/audits/usage_quotas_behaviour.sql` (create) | Rolled-back SQL behaviour tests |
| `supabase/audits/usage_quotas_rls.sql` (create) | Rolled-back SQL security audit |
| `scripts/usage-concurrency-test.mjs` (create) | Real parallel reserve test through the Management API |
| `supabase/functions/_shared/usage.ts` (create) | `reserveUsage` / `refundUsage` wrappers for edge functions |
| `src/lib/usageServer.test.ts` (create) | Tests for the wrappers with a fake client |
| `supabase/functions/_shared/hunterLimits.ts` (modify) | Parse Hunter's renewal date |
| `supabase/functions/run-deep-find/index.ts` (modify) | Return `reset_date` from `hunter_account` |
| `src/lib/deepFind.ts` (modify) | `resetDate` on `HunterAllowance` |
| `src/hooks/useUsage.ts` (create) | Snapshot hook with polling + realtime |
| `src/components/layout/UsageMeter.tsx` (create) | The chip and hover/focus panel |
| `src/components/layout/TopBar.tsx` (modify) | Mount the meter between theme toggle and organisation switcher |
| `src/components/settings/UsageLimitsCard.tsx` (create) | Admin limits card |
| `src/pages/Settings.tsx` (modify) | Render the card |
| `CLAUDE.md`, `docs/AUTOMATIONS.md` (modify) | Record what shipped |

---

### Task 1: Usage rules module

**Files:**
- Create: `supabase/functions/_shared/usageRules.ts`
- Test: `src/lib/usageRules.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `type UsageResource = 'worker_scrape' | 'worker_verify' | 'worker_fetch'`
  - `USAGE_RESOURCES: readonly UsageResource[]`, `USAGE_TEXT: Record<UsageResource, { label: string; noun: string }>`, `USAGE_DEFAULTS: Record<UsageResource, { orgLimit: number; globalLimit: number }>`, `MAX_ORG_LIMIT = 5000`
  - `interface UsageRow { resource: UsageResource; used: number; limit: number; globalUsed: number; globalLimit: number; resetsAt: string }`
  - `type UsageState = 'ok' | 'warning' | 'full' | 'shared_full'`
  - `londonDay(now: Date): string` (YYYY-MM-DD), `nextLondonMidnight(now: Date): Date`
  - `formatResetsIn(now: Date, resetsAt: Date): string`, `formatResetLine(now: Date, resetsAt: Date): string`
  - `remaining(row: UsageRow): number`, `usageState(row: UsageRow): UsageState`, `tightestAllowance(rows: UsageRow[]): UsageRow | null`
  - `chipText(row: UsageRow): string`, `stateLine(row: UsageRow): string`
  - `type ReserveResult`, `parseReserve(raw: unknown): ReserveResult`, `parseSnapshot(raw: unknown): UsageRow[]`
  - `refusalLine(reason: 'org_limit' | 'shared_pool' | 'bad_input' | 'error', resource: UsageResource, limit?: number): string`
  - `parseLimitInput(text: string): number | null`, `formatRenewalDate(iso: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/usageRules.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  chipText, formatRenewalDate, formatResetLine, formatResetsIn, londonDay, nextLondonMidnight, parseLimitInput,
  parseReserve, parseSnapshot, refusalLine, remaining, stateLine, tightestAllowance, usageState, USAGE_DEFAULTS,
  USAGE_RESOURCES, type UsageRow,
} from '../../supabase/functions/_shared/usageRules';

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  resource: 'worker_verify', used: 0, limit: 150, globalUsed: 0, globalLimit: 300, resetsAt: '2026-10-15T23:00:00Z', ...over,
});

describe('defaults', () => {
  it('match the agreed caps', () => {
    expect(USAGE_DEFAULTS).toEqual({
      worker_scrape: { orgLimit: 100, globalLimit: 400 },
      worker_verify: { orgLimit: 150, globalLimit: 300 },
      worker_fetch: { orgLimit: 300, globalLimit: 1000 },
    });
    expect(USAGE_RESOURCES).toEqual(['worker_scrape', 'worker_verify', 'worker_fetch']);
  });
});

describe('London day maths', () => {
  it('uses the London date, not UTC', () => {
    expect(londonDay(new Date('2026-10-14T12:00:00Z'))).toBe('2026-10-14');
    expect(londonDay(new Date('2026-07-01T23:30:00Z'))).toBe('2026-07-02'); // 00:30 BST on the 2nd
    expect(londonDay(new Date('2026-10-24T23:30:00Z'))).toBe('2026-10-25'); // 00:30 BST on the 25th
  });
  it('finds the next London midnight in summer and winter', () => {
    expect(nextLondonMidnight(new Date('2026-07-01T12:00:00Z')).toISOString()).toBe('2026-07-01T23:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-12-01T12:00:00Z')).toISOString()).toBe('2026-12-02T00:00:00.000Z');
  });
  it('handles the 25-hour day when the clocks go back (2026-10-25)', () => {
    expect(nextLondonMidnight(new Date('2026-10-24T12:00:00Z')).toISOString()).toBe('2026-10-24T23:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-10-24T23:30:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(nextLondonMidnight(new Date('2026-10-25T12:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });
  it('handles the 23-hour day when the clocks go forward (2027-03-28)', () => {
    expect(nextLondonMidnight(new Date('2027-03-27T12:00:00Z')).toISOString()).toBe('2027-03-28T00:00:00.000Z');
    expect(nextLondonMidnight(new Date('2027-03-28T12:00:00Z')).toISOString()).toBe('2027-03-28T23:00:00.000Z');
  });
});

describe('reset wording', () => {
  const at = (s: string) => new Date(s);
  it('formats the time left', () => {
    expect(formatResetsIn(at('2026-10-14T17:48:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 5h 12m');
    expect(formatResetsIn(at('2026-10-14T22:00:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 1h');
    expect(formatResetsIn(at('2026-10-14T22:30:00Z'), at('2026-10-14T23:00:00Z'))).toBe('in 30m');
    expect(formatResetsIn(at('2026-10-14T22:59:50Z'), at('2026-10-14T23:00:00Z'))).toBe('in less than a minute');
    expect(formatResetsIn(at('2026-10-14T23:00:01Z'), at('2026-10-14T23:00:00Z'))).toBe('in less than a minute');
  });
  it('builds the full line', () => {
    expect(formatResetLine(at('2026-10-14T17:48:00Z'), at('2026-10-14T23:00:00Z'))).toBe('Resets at 00:00 UK time (in 5h 12m)');
  });
  it('formats a provider renewal date, or nothing', () => {
    expect(formatRenewalDate('2026-10-18')).toBe('18 Oct');
    expect(formatRenewalDate('2026-10-18T00:00:00Z')).toBe('18 Oct');
    expect(formatRenewalDate('not a date')).toBeNull();
    expect(formatRenewalDate(null)).toBeNull();
    expect(formatRenewalDate(undefined)).toBeNull();
  });
});

describe('remaining and state', () => {
  it('uses the tighter of the organisation and shared allowance', () => {
    expect(remaining(row({ used: 40 }))).toBe(110);
    expect(remaining(row({ used: 40, globalUsed: 280 }))).toBe(20);
    expect(remaining(row({ used: 200 }))).toBe(0);
  });
  it('is ok below 80%, warning from 80%, full at the cap', () => {
    expect(usageState(row({ used: 119 }))).toBe('ok');
    expect(usageState(row({ used: 120 }))).toBe('warning');
    expect(usageState(row({ used: 149 }))).toBe('warning');
    expect(usageState(row({ used: 150 }))).toBe('full');
    expect(usageState(row({ used: 151 }))).toBe('full');
  });
  it('warns when the shared pool is 80% used and is shared_full when it is empty', () => {
    expect(usageState(row({ used: 0, globalUsed: 240 }))).toBe('warning');
    expect(usageState(row({ used: 10, globalUsed: 300 }))).toBe('shared_full');
    expect(usageState(row({ used: 10, globalUsed: 305 }))).toBe('shared_full');
  });
  it('treats a limit of 0 as full, and the organisation limit as winning over a full pool', () => {
    expect(usageState(row({ limit: 0 }))).toBe('full');
    expect(usageState(row({ used: 150, globalUsed: 300 }))).toBe('full');
  });
  it('an organisation limit above the shared cap is capped by the shared pool', () => {
    const r = row({ limit: 5000, used: 10, globalUsed: 300 });
    expect(remaining(r)).toBe(0);
    expect(usageState(r)).toBe('shared_full');
  });
});

describe('tightestAllowance and wording', () => {
  it('picks the most severe, then the lowest remaining fraction', () => {
    const rows = [
      row({ resource: 'worker_scrape', limit: 100, globalLimit: 400, used: 10 }),
      row({ resource: 'worker_verify', used: 140 }),
      row({ resource: 'worker_fetch', limit: 300, globalLimit: 1000, used: 299 }),
    ];
    expect(tightestAllowance(rows)?.resource).toBe('worker_fetch'); // 1 left of 300 beats 10 left of 150
    expect(tightestAllowance([row({ used: 150 }), row({ resource: 'worker_fetch', limit: 300, globalLimit: 1000, used: 299 })])?.resource).toBe('worker_verify'); // full beats warning
    expect(tightestAllowance([])).toBeNull();
  });
  it('writes the chip and list text in words', () => {
    expect(chipText(row({ used: 110 }))).toBe('Email checks: 40 left');
    expect(chipText(row({ used: 150 }))).toBe('Email checks: limit reached');
    expect(chipText(row({ used: 10, globalUsed: 300 }))).toBe('Email checks: shared allowance used up');
    expect(stateLine(row({ used: 110 }))).toBe('110 of 150 used today');
    expect(stateLine(row({ used: 150 }))).toBe('Limit reached (150 a day)');
    expect(stateLine(row({ used: 10, globalUsed: 300 }))).toBe('Shared worker allowance used up today');
  });
  it('writes the refusal line a feature shows when it skips the worker', () => {
    expect(refusalLine('org_limit', 'worker_verify', 150)).toBe('Extra lookup skipped: your organisation has used its 150 email checks for today (resets at 00:00 UK time).');
    expect(refusalLine('shared_pool', 'worker_scrape')).toBe('Extra lookup skipped: the shared worker allowance for site scrapes is used up for today (resets at 00:00 UK time).');
    expect(refusalLine('error', 'worker_fetch')).toBe('Extra lookup skipped: the usage check could not be completed.');
    expect(refusalLine('bad_input', 'worker_fetch')).toBe('Extra lookup skipped: the usage check could not be completed.');
  });
});

describe('parseReserve (fail closed)', () => {
  it('accepts a well-formed success and refusal', () => {
    expect(parseReserve({ ok: true, day: '2026-10-14', used: 3, limit: 150, global_used: 9, global_limit: 300 })).toEqual({ ok: true, day: '2026-10-14', used: 3, limit: 150 });
    expect(parseReserve({ ok: false, reason: 'org_limit', limit: 150 })).toEqual({ ok: false, reason: 'org_limit', limit: 150 });
    expect(parseReserve({ ok: false, reason: 'shared_pool' })).toEqual({ ok: false, reason: 'shared_pool' });
  });
  it('turns anything else into an error refusal', () => {
    for (const junk of [null, undefined, 'ok', 7, [], {}, { ok: 'true' }, { ok: true }, { ok: true, day: 'yesterday', used: 1, limit: 2 }, { ok: true, day: '2026-10-14', used: -1, limit: 2 }, { ok: false, reason: 'weird' }]) {
      expect(parseReserve(junk)).toEqual({ ok: false, reason: 'error' });
    }
  });
});

describe('parseSnapshot', () => {
  const good = (resource: string, over: Record<string, unknown> = {}) => ({ resource, used: 1, limit: 100, global_used: 2, global_limit: 400, resets_at: '2026-10-14T23:00:00+00:00', ...over });
  it('maps rows and orders them by resource', () => {
    const out = parseSnapshot([good('worker_fetch'), good('worker_scrape'), good('worker_verify')]);
    expect(out.map((r) => r.resource)).toEqual(['worker_scrape', 'worker_verify', 'worker_fetch']);
    expect(out[0]).toEqual({ resource: 'worker_scrape', used: 1, limit: 100, globalUsed: 2, globalLimit: 400, resetsAt: '2026-10-14T23:00:00+00:00' });
  });
  it('drops malformed rows and returns [] for junk', () => {
    expect(parseSnapshot([good('worker_scrape'), good('nope'), good('worker_verify', { used: 'x' }), good('worker_fetch', { resets_at: 'soon' }), null, 5])).toHaveLength(1);
    for (const junk of [null, undefined, {}, 'x', 3]) expect(parseSnapshot(junk)).toEqual([]);
  });
});

describe('parseLimitInput', () => {
  it('accepts whole numbers 0 to 5000 only', () => {
    expect(parseLimitInput('150')).toBe(150);
    expect(parseLimitInput(' 0 ')).toBe(0);
    expect(parseLimitInput('5000')).toBe(5000);
    for (const bad of ['', '5001', '-1', '1.5', '12a', '1e3', 'abc', '99999']) expect(parseLimitInput(bad)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/usageRules.test.ts`
Expected: FAIL (cannot find module `usageRules`).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/usageRules.ts`:

```ts
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
  if (reason === 'org_limit') return `Extra lookup skipped: your organisation has used its ${limit ?? ''} ${noun} for today (resets at 00:00 UK time).`.replace('its  ', 'its ');
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/usageRules.test.ts`
Expected: PASS, all tests green. If the London-maths tests fail on the clock-change dates, the bug is in `nextLondonMidnight`; do not weaken the tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/usageRules.ts src/lib/usageRules.test.ts
git commit -m "feat: usage rules module (limits, London-day maths, states, wording, parsing)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 059

**Files:**
- Create: `supabase/migrations/059_usage_quotas.sql`

**Interfaces:**
- Consumes: `organizations(id)`, `profiles(id)`, `is_org_member(UUID)`, `is_org_admin(UUID)` (migration 003).
- Produces: tables `usage_resources`, `usage_limits`, `usage_counters`, `usage_global_counters`; functions `public.usage_reserve(p_org UUID, p_resource TEXT, p_units INT) RETURNS JSONB` (keys `ok, reason, day, used, limit, global_used, global_limit`), `public.usage_refund(p_org UUID, p_resource TEXT, p_units INT, p_day DATE) RETURNS BOOLEAN`, `public.usage_snapshot(p_org UUID) RETURNS JSONB` (array of `{resource, used, limit, global_used, global_limit, resets_at}`).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/059_usage_quotas.sql`:

```sql
-- 059_usage_quotas.sql
-- Usage limits for the shared lookup worker (docs/superpowers/specs/2026-10-14-usage-quotas-design.md).
--
-- SECURITY NOTES
-- * usage_reserve / usage_refund are SECURITY DEFINER, search_path = '', granted to service_role ONLY (the edge
--   functions call them). The browser can never move a counter.
-- * usage_reserve locks the worker-wide row FIRST and the organisation row second, in one transaction, so concurrent
--   calls serialise and can never overshoot either cap, and two callers can never deadlock.
-- * usage_snapshot is SECURITY DEFINER but starts with an is_org_member check (42501 when not a member).
-- * Organisation admins may edit THEIR OWN limits (0 to 5000) through RLS; the worker-wide cap always wins because
--   usage_reserve checks both. updated_by / updated_at are stamped by a trigger, not by the client.
-- * Days are London days: day = (now() AT TIME ZONE 'Europe/London')::date.
-- No existing table, policy or grant is changed.

-- 1. Tables ---------------------------------------------------------------------------
CREATE TABLE public.usage_resources (
  resource TEXT PRIMARY KEY CHECK (resource IN ('worker_scrape', 'worker_verify', 'worker_fetch')),
  label TEXT NOT NULL,
  default_org_limit INT NOT NULL CHECK (default_org_limit BETWEEN 0 AND 5000),
  global_limit INT NOT NULL CHECK (global_limit BETWEEN 0 AND 100000)
);
-- Keep in step with USAGE_DEFAULTS in supabase/functions/_shared/usageRules.ts.
INSERT INTO public.usage_resources (resource, label, default_org_limit, global_limit) VALUES
  ('worker_scrape', 'Site scrapes', 100, 400),
  ('worker_verify', 'Email checks', 150, 300),
  ('worker_fetch', 'Page fetches', 300, 1000);

CREATE TABLE public.usage_limits (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  daily_limit INT NOT NULL CHECK (daily_limit BETWEEN 0 AND 5000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, resource)
);

CREATE TABLE public.usage_counters (
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  day DATE NOT NULL,
  used INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (org_id, resource, day)
);

CREATE TABLE public.usage_global_counters (
  resource TEXT NOT NULL REFERENCES public.usage_resources(resource),
  day DATE NOT NULL,
  used INT NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (resource, day)
);

-- 2. RLS and grants ---------------------------------------------------------------------
ALTER TABLE public.usage_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_global_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_resources_select" ON public.usage_resources FOR SELECT TO authenticated USING (true);
CREATE POLICY "usage_limits_select" ON public.usage_limits FOR SELECT USING (is_org_member(org_id));
CREATE POLICY "usage_limits_insert" ON public.usage_limits FOR INSERT WITH CHECK (is_org_admin(org_id));
CREATE POLICY "usage_limits_update" ON public.usage_limits FOR UPDATE USING (is_org_admin(org_id)) WITH CHECK (is_org_admin(org_id));
CREATE POLICY "usage_limits_delete" ON public.usage_limits FOR DELETE USING (is_org_admin(org_id));
CREATE POLICY "usage_counters_select" ON public.usage_counters FOR SELECT USING (is_org_member(org_id));
-- usage_global_counters: no policy at all, so no client can read or write it (usage_snapshot reads it as definer).

REVOKE ALL ON public.usage_resources, public.usage_limits, public.usage_counters, public.usage_global_counters FROM anon, authenticated;
GRANT SELECT ON public.usage_resources TO authenticated;
GRANT SELECT, DELETE ON public.usage_limits TO authenticated;
GRANT INSERT (org_id, resource, daily_limit) ON public.usage_limits TO authenticated;
GRANT UPDATE (daily_limit) ON public.usage_limits TO authenticated;
GRANT SELECT ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_resources, public.usage_limits, public.usage_counters, public.usage_global_counters TO service_role;

-- 3. Stamp who changed a limit ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_limits_stamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER usage_limits_stamp BEFORE INSERT OR UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.usage_limits_stamp();
REVOKE ALL ON FUNCTION public.usage_limits_stamp() FROM PUBLIC, anon, authenticated;

-- 4. Reserve ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_reserve(p_org UUID, p_resource TEXT, p_units INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_res public.usage_resources%ROWTYPE;
  v_org_limit INT;
  v_org_used INT;
  v_g_used INT;
BEGIN
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 OR p_org IS NULL OR p_resource IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT * INTO v_res FROM public.usage_resources WHERE resource = p_resource;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bad_input');
  END IF;
  SELECT COALESCE((SELECT daily_limit FROM public.usage_limits WHERE org_id = p_org AND resource = p_resource), v_res.default_org_limit)
    INTO v_org_limit;

  INSERT INTO public.usage_global_counters (resource, day, used) VALUES (p_resource, v_day, 0) ON CONFLICT DO NOTHING;
  INSERT INTO public.usage_counters (org_id, resource, day, used) VALUES (p_org, p_resource, v_day, 0) ON CONFLICT DO NOTHING;
  -- Fixed lock order: worker-wide row first, then the organisation row.
  SELECT used INTO v_g_used FROM public.usage_global_counters WHERE resource = p_resource AND day = v_day FOR UPDATE;
  SELECT used INTO v_org_used FROM public.usage_counters WHERE org_id = p_org AND resource = p_resource AND day = v_day FOR UPDATE;

  IF v_org_used + p_units > v_org_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'org_limit', 'day', v_day, 'used', v_org_used, 'limit', v_org_limit,
      'global_used', v_g_used, 'global_limit', v_res.global_limit);
  END IF;
  IF v_g_used + p_units > v_res.global_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'shared_pool', 'day', v_day, 'used', v_org_used, 'limit', v_org_limit,
      'global_used', v_g_used, 'global_limit', v_res.global_limit);
  END IF;

  UPDATE public.usage_global_counters SET used = used + p_units WHERE resource = p_resource AND day = v_day;
  UPDATE public.usage_counters SET used = used + p_units WHERE org_id = p_org AND resource = p_resource AND day = v_day;
  RETURN jsonb_build_object('ok', true, 'day', v_day, 'used', v_org_used + p_units, 'limit', v_org_limit,
    'global_used', v_g_used + p_units, 'global_limit', v_res.global_limit);
END;
$$;

-- 5. Refund (only for units this organisation actually used, only for today or yesterday) ----
CREATE OR REPLACE FUNCTION public.usage_refund(p_org UUID, p_resource TEXT, p_units INT, p_day DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_org_used INT;
BEGIN
  IF p_units IS NULL OR p_units < 1 OR p_units > 10 OR p_org IS NULL OR p_resource IS NULL
     OR p_day IS NULL OR p_day > v_today OR p_day < v_today - 1 THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.usage_global_counters WHERE resource = p_resource AND day = p_day FOR UPDATE;
  SELECT used INTO v_org_used FROM public.usage_counters WHERE org_id = p_org AND resource = p_resource AND day = p_day FOR UPDATE;
  IF NOT FOUND OR v_org_used < p_units THEN RETURN false; END IF;
  UPDATE public.usage_counters SET used = used - p_units WHERE org_id = p_org AND resource = p_resource AND day = p_day;
  UPDATE public.usage_global_counters SET used = GREATEST(0, used - p_units) WHERE resource = p_resource AND day = p_day;
  RETURN true;
END;
$$;

-- 6. Snapshot for the meter ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.usage_snapshot(p_org UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
BEGIN
  IF p_org IS NULL OR NOT public.is_org_member(p_org) THEN
    RAISE EXCEPTION 'not a member of this organisation' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
        'resource', r.resource,
        'used', COALESCE(c.used, 0),
        'limit', COALESCE(l.daily_limit, r.default_org_limit),
        'global_used', COALESCE(g.used, 0),
        'global_limit', r.global_limit,
        'resets_at', ((v_day + 1)::timestamp AT TIME ZONE 'Europe/London')
      ) ORDER BY CASE r.resource WHEN 'worker_scrape' THEN 1 WHEN 'worker_verify' THEN 2 ELSE 3 END)
    FROM public.usage_resources r
    LEFT JOIN public.usage_limits l ON l.org_id = p_org AND l.resource = r.resource
    LEFT JOIN public.usage_counters c ON c.org_id = p_org AND c.resource = r.resource AND c.day = v_day
    LEFT JOIN public.usage_global_counters g ON g.resource = r.resource AND g.day = v_day
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.usage_reserve(UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usage_refund(UUID, TEXT, INT, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.usage_snapshot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_reserve(UUID, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_refund(UUID, TEXT, INT, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.usage_snapshot(UUID) TO authenticated, service_role;

-- 7. Realtime: the meter refreshes when an organisation's counters change ------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.usage_counters;
```

- [ ] **Step 2: Show Kevin the SQL and get a yes before applying**

This is a database change on the live project. Present the file path and a three-line summary (four new tables, three functions, no existing object touched) and wait for an explicit yes. Do not apply without it.

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration` tool (load it first with ToolSearch `select:mcp__plugin_supabase_supabase__apply_migration`) with `name: "059_usage_quotas"` and the file's SQL, project `wgomksxelyfkzepbnkdd`.
Expected: success with no rows returned.

- [ ] **Step 4: Check the objects exist and the advisors are quiet**

Run `list_tables` (schema `public`) and confirm the four `usage_*` tables exist with RLS enabled. Run `get_advisors` (type `security`) and confirm no NEW warning mentions `usage_*` (a warning that only restates the deliberate lack of a policy on `usage_global_counters` is expected; record it).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/059_usage_quotas.sql
git commit -m "feat: migration 059 usage quotas (tables, RLS, atomic reserve/refund, snapshot)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Database verification (behaviour, concurrency, security)

**Files:**
- Create: `supabase/audits/usage_quotas_behaviour.sql`
- Create: `supabase/audits/usage_quotas_rls.sql`
- Create: `scripts/usage-concurrency-test.mjs`

**Interfaces:**
- Consumes: the functions and tables from Task 2.
- Produces: a recorded PASS/FAIL table (pasted into CLAUDE.md in Task 9).

Both SQL files end by raising an exception whose message is the report, so the whole script rolls back and leaves nothing behind. Run each with the Supabase MCP `execute_sql` tool (load it with ToolSearch `select:mcp__plugin_supabase_supabase__execute_sql`). The result is an error whose message starts with `USAGE_AUDIT`; that is the expected, successful outcome.

- [ ] **Step 1: Write the behaviour test**

Create `supabase/audits/usage_quotas_behaviour.sql`:

```sql
-- Rolled-back behaviour test for migration 059. Expected outcome: an error "USAGE_AUDIT" followed by PASS/FAIL lines.
DO $$
DECLARE
  r TEXT[] := ARRAY[]::TEXT[];
  v_org UUID; v_org2 UUID; v_res JSONB; v_ok BOOLEAN; v_used INT; v_gused INT; v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_snap JSONB; i INT; v_succ INT;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('usage-audit-a') RETURNING id INTO v_org;
  INSERT INTO public.organizations (name) VALUES ('usage-audit-b') RETURNING id INTO v_org2;

  -- 1. default limit is honoured: 150 verify checks pass, the 151st is refused as org_limit
  v_succ := 0;
  FOR i IN 1..151 LOOP
    v_res := public.usage_reserve(v_org, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  r := r || (CASE WHEN v_succ = 150 AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 1 default org limit 150 then org_limit (successes=' || v_succ || ', last reason=' || COALESCE(v_res->>'reason','null') || ')';

  -- 2. a refused reserve leaves counters unchanged
  SELECT used INTO v_used FROM public.usage_counters WHERE org_id = v_org AND resource = 'worker_verify' AND day = v_day;
  r := r || (CASE WHEN v_used = 150 THEN 'PASS' ELSE 'FAIL' END) || ' 2 refused reserve leaves the org counter at 150 (is ' || v_used || ')';

  -- 3. worker-wide cap: org B has its own room, but the shared pool (300) is what binds after A used 150 and B asks for 151
  v_succ := 0;
  FOR i IN 1..160 LOOP
    v_res := public.usage_reserve(v_org2, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  r := r || (CASE WHEN v_succ = 150 AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 3 org B gets its own 150 (successes=' || v_succ || ')';

  -- 4. lower the shared cap to 160 inside this rolled-back test: only 10 more pass, reason shared_pool
  UPDATE public.usage_resources SET global_limit = 310 WHERE resource = 'worker_verify';
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org, 'worker_verify', 400);
  v_succ := 0;
  FOR i IN 1..20 LOOP
    v_res := public.usage_reserve(v_org, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  SELECT used INTO v_gused FROM public.usage_global_counters WHERE resource = 'worker_verify' AND day = v_day;
  r := r || (CASE WHEN v_succ = 10 AND v_res->>'reason' = 'shared_pool' AND v_gused = 310 THEN 'PASS' ELSE 'FAIL' END) || ' 4 shared cap binds even when the org limit is higher (successes=' || v_succ || ', global=' || v_gused || ')';

  -- 5. limit 0 refuses with org_limit
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org2, 'worker_fetch', 0);
  v_res := public.usage_reserve(v_org2, 'worker_fetch', 1);
  r := r || (CASE WHEN NOT (v_res->>'ok')::boolean AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 5 limit 0 refuses';

  -- 6. multi-unit reserve (deep scrape = 3) counts 3 and refuses when 3 do not fit
  v_res := public.usage_reserve(v_org, 'worker_scrape', 3);
  r := r || (CASE WHEN (v_res->>'ok')::boolean AND (v_res->>'used')::int = 3 THEN 'PASS' ELSE 'FAIL' END) || ' 6 three units counted';
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org, 'worker_scrape', 4);
  v_res := public.usage_reserve(v_org, 'worker_scrape', 3);
  r := r || (CASE WHEN NOT (v_res->>'ok')::boolean AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 7 3 units refused when only 1 is left';

  -- 7. bad input is refused without touching anything
  r := r || (CASE WHEN v_res IS NOT NULL
      AND (public.usage_reserve(v_org, 'worker_scrape', 0)->>'reason') = 'bad_input'
      AND (public.usage_reserve(v_org, 'worker_scrape', 11)->>'reason') = 'bad_input'
      AND (public.usage_reserve(v_org, 'nope', 1)->>'reason') = 'bad_input'
      AND (public.usage_reserve(gen_random_uuid(), 'worker_scrape', 1)->>'reason') = 'bad_input'
      AND (public.usage_reserve(NULL, 'worker_scrape', 1)->>'reason') = 'bad_input'
      THEN 'PASS' ELSE 'FAIL' END) || ' 8 bad input (0, 11, unknown resource, unknown org, null) refused';

  -- 8. refund: works for used units, then refuses more than used, wrong day, bad units
  v_ok := public.usage_refund(v_org, 'worker_scrape', 3, v_day);
  SELECT used INTO v_used FROM public.usage_counters WHERE org_id = v_org AND resource = 'worker_scrape' AND day = v_day;
  r := r || (CASE WHEN v_ok AND v_used = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 9 refund of used units works (ok=' || v_ok || ', used=' || v_used || ')';
  r := r || (CASE WHEN NOT public.usage_refund(v_org, 'worker_scrape', 1, v_day) THEN 'PASS' ELSE 'FAIL' END) || ' 10 cannot refund more than used';
  r := r || (CASE WHEN NOT public.usage_refund(v_org, 'worker_verify', 1, v_day + 1)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 1, v_day - 2)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 0, v_day)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 11, v_day) THEN 'PASS' ELSE 'FAIL' END) || ' 11 refund refuses future day, too-old day and bad units';

  -- 9. a refund frees room again (global counter goes down with it)
  SELECT used INTO v_gused FROM public.usage_global_counters WHERE resource = 'worker_verify' AND day = v_day;
  v_ok := public.usage_refund(v_org2, 'worker_verify', 2, v_day);
  v_res := public.usage_reserve(v_org2, 'worker_verify', 1);
  r := r || (CASE WHEN v_ok AND (v_res->>'ok')::boolean THEN 'PASS' ELSE 'FAIL' END) || ' 12 refund frees room (ok=' || v_ok || ')';

  -- 10. snapshot as the database owner has no auth.uid(), so it must refuse (membership check)
  BEGIN
    v_snap := public.usage_snapshot(v_org);
    r := r || 'FAIL 13 snapshot should refuse a caller who is not a member';
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS 13 snapshot refuses a non-member (42501)';
  END;

  RAISE EXCEPTION E'USAGE_AUDIT\n%', array_to_string(r, E'\n');
END $$;
```

- [ ] **Step 2: Run the behaviour test and check every line says PASS**

Run the file's contents through `execute_sql`.
Expected: an error message `USAGE_AUDIT` followed by 13 lines, all starting `PASS`. Any `FAIL` line is a real bug in Task 2's SQL: fix the migration with a new migration `060_...` only if 059 is already applied and used by anything live; since nothing uses it yet, instead write the correction as an additional `CREATE OR REPLACE FUNCTION` migration and apply it, then rerun. Also run `SELECT count(*) FROM public.organizations WHERE name LIKE 'usage-audit-%'` and expect 0 (the rollback worked).

- [ ] **Step 3: Write the security audit**

Create `supabase/audits/usage_quotas_rls.sql`:

```sql
-- Rolled-back security audit for migration 059 (same method as the cycle 2/3 audits, but nothing persists).
-- Expected outcome: an error "USAGE_AUDIT" followed by PASS/FAIL lines.
DO $$
DECLARE
  r TEXT[] := ARRAY[]::TEXT[];
  v_a UUID; v_b UUID; v_admin_a UUID := gen_random_uuid(); v_member_a UUID := gen_random_uuid(); v_admin_b UUID := gen_random_uuid();
  n INT; v_snap JSONB; v_by UUID;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('usage-rls-a') RETURNING id INTO v_a;
  INSERT INTO public.organizations (name) VALUES ('usage-rls-b') RETURNING id INTO v_b;
  -- Three throwaway users (the handle_new_user trigger creates their profiles).
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (v_admin_a, 'usage-admin-a@example.invalid'), (v_member_a, 'usage-member-a@example.invalid'), (v_admin_b, 'usage-admin-b@example.invalid')) AS u(id, email);
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (v_a, v_admin_a, 'admin'), (v_a, v_member_a, 'contractor'), (v_b, v_admin_b, 'admin');
  -- Some usage so there is something to read.
  PERFORM public.usage_reserve(v_a, 'worker_scrape', 2);
  PERFORM public.usage_reserve(v_b, 'worker_scrape', 5);

  -- ===== member of A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.usage_counters;
  r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 1 member sees only their own organisation''s counters (rows=' || n || ')';
  SELECT public.usage_snapshot(v_a) INTO v_snap;
  r := r || (CASE WHEN jsonb_array_length(v_snap) = 3 THEN 'PASS' ELSE 'FAIL' END) || ' 2 member can read their snapshot (3 resources)';
  BEGIN PERFORM public.usage_snapshot(v_b); r := r || 'FAIL 3 member read another organisation''s snapshot';
  EXCEPTION WHEN insufficient_privilege THEN r := r || 'PASS 3 snapshot of another organisation refused (42501)'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_scrape', 999); r := r || 'FAIL 4 non-admin inserted a limit';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 4 non-admin cannot insert a limit (' || SQLSTATE || ')'; END;
  BEGIN UPDATE public.usage_counters SET used = 0; GET DIAGNOSTICS n = ROW_COUNT; r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 5 member cannot update counters (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 5 member cannot update counters (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_counters (org_id, resource, day, used) VALUES (v_a, 'worker_fetch', current_date, 0); r := r || 'FAIL 6 member inserted a counter';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 6 member cannot insert counters (' || SQLSTATE || ')'; END;
  BEGIN PERFORM 1 FROM public.usage_global_counters; r := r || 'FAIL 7 member can read worker-wide counters';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 7 worker-wide counters unreadable (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_reserve(v_a, 'worker_scrape', 1); r := r || 'FAIL 8 member can call usage_reserve';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 8 usage_reserve not callable by members (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_refund(v_a, 'worker_scrape', 1, current_date); r := r || 'FAIL 9 member can call usage_refund';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 9 usage_refund not callable by members (' || SQLSTATE || ')'; END;
  BEGIN UPDATE public.usage_resources SET global_limit = 99999; GET DIAGNOSTICS n = ROW_COUNT; r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 10 member cannot change the shared caps (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 10 member cannot change the shared caps (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== admin of A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_scrape', 60); r := r || 'PASS 11 admin can set their own limit';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL 11 admin could not set a limit (' || SQLERRM || ')'; END;
  EXECUTE 'RESET ROLE';
  SELECT updated_by INTO v_by FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_scrape';
  r := r || (CASE WHEN v_by = v_admin_a THEN 'PASS' ELSE 'FAIL' END) || ' 12 updated_by is stamped by the trigger';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit, updated_by) VALUES (v_a, 'worker_verify', 70, v_admin_b); EXCEPTION WHEN OTHERS THEN NULL; END;
  EXECUTE 'RESET ROLE';
  SELECT updated_by INTO v_by FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_verify';
  r := r || (CASE WHEN v_by IS NULL OR v_by = v_admin_a THEN 'PASS' ELSE 'FAIL' END) || ' 13 a client cannot forge updated_by';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_b, 'worker_scrape', 1); r := r || 'FAIL 14 admin of A set a limit for B';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 14 admin of A cannot set a limit for B (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_fetch', 5001); r := r || 'FAIL 15 limit above 5000 accepted';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 15 limit above 5000 refused (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_fetch', -1); r := r || 'FAIL 16 negative limit accepted';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 16 negative limit refused (' || SQLSTATE || ')'; END;
  BEGIN DELETE FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_scrape'; GET DIAGNOSTICS n = ROW_COUNT; r := r || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 17 admin can reset their own limit to default (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || 'FAIL 17 admin delete failed (' || SQLERRM || ')'; END;
  BEGIN UPDATE public.usage_limits SET daily_limit = 1 WHERE org_id = v_b; GET DIAGNOSTICS n = ROW_COUNT; r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 18 admin of A cannot edit B''s limits (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 18 admin of A cannot edit B''s limits (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== outsider (admin of B) cannot see A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.usage_counters WHERE org_id = v_a;
  r := r || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 19 admin of B cannot see A''s counters (rows=' || n || ')';
  EXECUTE 'RESET ROLE';

  -- ===== anon =====
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM 1 FROM public.usage_counters; r := r || 'FAIL 20 anon can read counters';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 20 anon cannot read counters (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_snapshot(v_a); r := r || 'FAIL 21 anon can call usage_snapshot';
  EXCEPTION WHEN OTHERS THEN r := r || 'PASS 21 anon cannot call usage_snapshot (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION E'USAGE_AUDIT\n%', array_to_string(r, E'\n');
END $$;
```

- [ ] **Step 4: Run the security audit and check every line says PASS**

Run via `execute_sql`. Expected: `USAGE_AUDIT` plus 21 lines, all `PASS`. Then confirm nothing remains: `SELECT count(*) FROM public.organizations WHERE name LIKE 'usage-rls-%'` and `SELECT count(*) FROM auth.users WHERE email LIKE 'usage-%@example.invalid'` both return 0.
If an audit step errors before the final RAISE (for example `auth.users` needs another column), fix the audit script, not the migration, unless a line says FAIL.

- [ ] **Step 5: Write and run the real concurrency test**

Create `scripts/usage-concurrency-test.mjs`:

```js
// Fires many usage_reserve calls IN PARALLEL (each is its own database connection and transaction through the
// Supabase Management API) and proves the cap holds. Usage: node scripts/usage-concurrency-test.mjs
// Reads SUPABASE_ACCESS_TOKEN from the project's gitignored .env. Creates one throwaway organisation, restores the
// worker-wide counter it touched, and deletes the organisation (cascade removes its limit and counters).
import { readFileSync } from 'node:fs';

const REF = 'wgomksxelyfkzepbnkdd';
const LIMIT = 10;
const CALLS = 40;
const RESOURCE = 'worker_fetch';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN missing from .env');

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL failed (${res.status})`);
  return res.json();
}

const day = "(now() AT TIME ZONE 'Europe/London')::date";
const [{ id: org }] = await sql("INSERT INTO public.organizations (name) VALUES ('usage-concurrency-test') RETURNING id");
let failed = false;
try {
  const before = (await sql(`SELECT COALESCE((SELECT used FROM public.usage_global_counters WHERE resource = '${RESOURCE}' AND day = ${day}), 0) AS used`))[0].used;
  await sql(`INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES ('${org}', '${RESOURCE}', ${LIMIT})`);

  const results = await Promise.all(Array.from({ length: CALLS }, () => sql(`SELECT public.usage_reserve('${org}', '${RESOURCE}', 1) AS r`)));
  const oks = results.filter((r) => r[0].r.ok === true).length;
  const refusals = results.filter((r) => r[0].r.ok === false && r[0].r.reason === 'org_limit').length;
  const used = (await sql(`SELECT used FROM public.usage_counters WHERE org_id = '${org}' AND resource = '${RESOURCE}' AND day = ${day}`))[0].used;
  const after = (await sql(`SELECT used FROM public.usage_global_counters WHERE resource = '${RESOURCE}' AND day = ${day}`))[0].used;

  console.log(`parallel calls=${CALLS} limit=${LIMIT} -> ok=${oks}, org_limit refusals=${refusals}, org counter=${used}, worker-wide counter moved by ${after - before}`);
  const pass = oks === LIMIT && refusals === CALLS - LIMIT && used === LIMIT && after - before === LIMIT;
  console.log(pass ? 'PASS: the cap held under concurrency' : 'FAIL: the cap did not hold');
  failed = !pass;
  // Put the worker-wide counter back exactly as it was.
  await sql(`UPDATE public.usage_global_counters SET used = ${before} WHERE resource = '${RESOURCE}' AND day = ${day}`);
} finally {
  await sql(`DELETE FROM public.organizations WHERE id = '${org}'`);
  const left = (await sql("SELECT count(*)::int AS n FROM public.organizations WHERE name = 'usage-concurrency-test'"))[0].n;
  console.log(`cleanup: leftover test organisations = ${left}`);
}
process.exit(failed ? 1 : 0);
```

Run: `node scripts/usage-concurrency-test.mjs`
Expected: `ok=10, org_limit refusals=30, org counter=10, worker-wide counter moved by 10`, then `PASS`, and `leftover test organisations = 0`. If reading `.env` is refused by the permission system, stop and ask Kevin to run the script himself with `! node scripts/usage-concurrency-test.mjs` and paste the output; do not work around it.

- [ ] **Step 6: Commit**

```bash
git add supabase/audits/usage_quotas_behaviour.sql supabase/audits/usage_quotas_rls.sql scripts/usage-concurrency-test.mjs
git commit -m "test: usage quotas behaviour, security and concurrency audits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server-side reserve and refund wrappers

**Files:**
- Create: `supabase/functions/_shared/usage.ts`
- Test: `src/lib/usageServer.test.ts`

**Interfaces:**
- Consumes: `parseReserve`, `ReserveResult`, `UsageResource` from `usageRules.ts`; RPCs from Task 2.
- Produces (used by sub-project C):
  - `reserveUsage(service: UsageClient, orgId: string, resource: UsageResource, units?: number): Promise<ReserveResult>`
  - `refundUsage(service: UsageClient, orgId: string, resource: UsageResource, units: number, day: string): Promise<boolean>`
  - `interface UsageClient { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> }` (a real `SupabaseClient` satisfies it)

- [ ] **Step 1: Write the failing test**

Create `src/lib/usageServer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { refundUsage, reserveUsage, type UsageClient } from '../../supabase/functions/_shared/usage';

const client = (reply: { data: unknown; error: { message: string } | null } | (() => never)): UsageClient & { calls: Array<[string, Record<string, unknown>]> } => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    rpc: (fn, args) => {
      calls.push([fn, args]);
      if (typeof reply === 'function') reply();
      return Promise.resolve(reply as { data: unknown; error: { message: string } | null });
    },
  };
};

describe('reserveUsage', () => {
  it('calls usage_reserve with the organisation, resource and units, and parses the answer', async () => {
    const c = client({ data: { ok: true, day: '2026-10-14', used: 1, limit: 100, global_used: 1, global_limit: 400 }, error: null });
    expect(await reserveUsage(c, 'org-1', 'worker_scrape', 3)).toEqual({ ok: true, day: '2026-10-14', used: 1, limit: 100 });
    expect(c.calls).toEqual([['usage_reserve', { p_org: 'org-1', p_resource: 'worker_scrape', p_units: 3 }]]);
  });
  it('defaults to one unit', async () => {
    const c = client({ data: { ok: false, reason: 'org_limit', limit: 150 }, error: null });
    expect(await reserveUsage(c, 'org-1', 'worker_verify')).toEqual({ ok: false, reason: 'org_limit', limit: 150 });
    expect(c.calls[0]?.[1]).toMatchObject({ p_units: 1 });
  });
  it('fails closed on an rpc error, junk, or a thrown exception', async () => {
    expect(await reserveUsage(client({ data: null, error: { message: 'boom' } }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
    expect(await reserveUsage(client({ data: 'yes', error: null }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
    expect(await reserveUsage(client(() => { throw new Error('network'); }), 'o', 'worker_fetch')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('refundUsage', () => {
  it('calls usage_refund with the day returned by the reserve', async () => {
    const c = client({ data: true, error: null });
    expect(await refundUsage(c, 'org-1', 'worker_fetch', 1, '2026-10-14')).toBe(true);
    expect(c.calls).toEqual([['usage_refund', { p_org: 'org-1', p_resource: 'worker_fetch', p_units: 1, p_day: '2026-10-14' }]]);
  });
  it('never throws: an error or junk is just false', async () => {
    expect(await refundUsage(client({ data: null, error: { message: 'x' } }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
    expect(await refundUsage(client({ data: 'maybe', error: null }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
    expect(await refundUsage(client(() => { throw new Error('network'); }), 'o', 'worker_fetch', 1, '2026-10-14')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/usageServer.test.ts`
Expected: FAIL (cannot find module `usage`).

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/usage.ts`:

```ts
// supabase/functions/_shared/usage.ts
// Edge-function side of the worker usage limits. Reserve BEFORE calling the worker; refund (with the day the reserve
// returned) when the call did no work (worker unreachable, busy or not configured). A cache hit never reserves.
// Fails closed: an error here means "not allowed", so a broken check can never lift a cap.
import { parseReserve, type ReserveResult, type UsageResource } from './usageRules.ts';

/** The slice of a Supabase client these helpers need (a real SupabaseClient satisfies it). */
export interface UsageClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function reserveUsage(service: UsageClient, orgId: string, resource: UsageResource, units = 1): Promise<ReserveResult> {
  try {
    const { data, error } = await service.rpc('usage_reserve', { p_org: orgId, p_resource: resource, p_units: units });
    if (error) {
      console.error('usage_reserve failed:', error.message);
      return { ok: false, reason: 'error' };
    }
    return parseReserve(data);
  } catch (err) {
    console.error('usage_reserve threw:', err instanceof Error ? err.message : 'unknown');
    return { ok: false, reason: 'error' };
  }
}

/** Best effort: returns whether the units were given back. Never throws. */
export async function refundUsage(service: UsageClient, orgId: string, resource: UsageResource, units: number, day: string): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('usage_refund', { p_org: orgId, p_resource: resource, p_units: units, p_day: day });
    if (error) {
      console.error('usage_refund failed:', error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error('usage_refund threw:', err instanceof Error ? err.message : 'unknown');
    return false;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/usageServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/usage.ts src/lib/usageServer.test.ts
git commit -m "feat: reserveUsage / refundUsage wrappers (fail closed)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hunter renewal date

**Files:**
- Modify: `supabase/functions/_shared/hunterLimits.ts` (the `HunterAccount` interface near line 58 and `parseHunterAccount` near line 71)
- Modify: `supabase/functions/run-deep-find/index.ts` (the `hunter_account` response, near line 92)
- Modify: `src/lib/deepFind.ts` (`HunterAllowance` near line 55 and `fetchHunterAllowance` near line 66)
- Modify: `src/lib/hunterLimits.test.ts` (the account test near line 29)

**Interfaces:**
- Consumes: Hunter's `GET /v2/account` body (`data.reset_date`, a `YYYY-MM-DD` string; **shape unverified**, so it is parsed defensively and absent means "no date shown").
- Produces: `HunterAccount.resetDate: string | null`; `hunter_account` action field `reset_date: string | null`; `HunterAllowance.resetDate: string | null`.

- [ ] **Step 1: Update the existing test so it fails**

In `src/lib/hunterLimits.test.ts`, replace the body of the account test (the lines that assert `toEqual({ searchesUsed: 20, ... })`) with:

```ts
    const a = parseHunterAccount({ data: { reset_date: '2026-10-18', requests: { searches: { used: 20, available: 25 }, credits: { used: 3, available: 50 } } } });
    expect(a).toEqual({ searchesUsed: 20, searchesAvailable: 25, searchesLeft: 5, creditsLeft: 47, resetDate: '2026-10-18' });
    expect(parseHunterAccount({ data: { requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
    expect(parseHunterAccount({ data: { reset_date: 'soon', requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
    expect(parseHunterAccount({ data: { reset_date: '2026-10-18<script>', requests: { searches: { used: 1, available: 25 } } } })?.resetDate).toBeNull();
```

Keep the remaining lines of that test (the `hunterAccountLine`, `hunterAccountEmpty` and null assertions) unchanged.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/hunterLimits.test.ts`
Expected: FAIL on the first `toEqual` (no `resetDate` yet).

- [ ] **Step 3: Implement**

In `supabase/functions/_shared/hunterLimits.ts`, change the interface and parser:

```ts
export interface HunterAccount {
  searchesUsed: number | null;
  searchesAvailable: number | null;
  searchesLeft: number | null;
  creditsLeft: number | null;
  /** Hunter's `data.reset_date` (YYYY-MM-DD) when it is a plain date, else null. Shape UNVERIFIED. */
  resetDate: string | null;
}
```

and inside `parseHunterAccount`, replace the line that builds `out` with:

```ts
  const rawReset = (data as { reset_date?: unknown }).reset_date;
  const resetDate = typeof rawReset === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawReset) ? rawReset : null;
  const out = { searchesUsed: s.used, searchesAvailable: s.available, searchesLeft: left(s), creditsLeft: left(c), resetDate };
```

In `supabase/functions/run-deep-find/index.ts`, add `reset_date: a?.resetDate ?? null,` to the object returned for a successful account read (next to `credits_left`).

In `src/lib/deepFind.ts`, add `resetDate: string | null;` to `HunterAllowance`, and in `fetchHunterAllowance` add `resetDate: typeof d.reset_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.reset_date) ? d.reset_date : null,` to the returned object.

- [ ] **Step 4: Run the whole suite and the type check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests pass and no type errors. If a type error names another place that builds a `HunterAccount` or `HunterAllowance` literal, add `resetDate: null` there.

- [ ] **Step 5: Deploy `run-deep-find` (edge function) and commit**

Run: `npx supabase functions deploy run-deep-find`
Expected: deployed. Then:

```bash
git add supabase/functions/_shared/hunterLimits.ts supabase/functions/run-deep-find/index.ts src/lib/deepFind.ts src/lib/hunterLimits.test.ts
git commit -m "feat: Hunter allowance includes the renewal date when Hunter reports it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Client data layer (`useUsage`)

**Files:**
- Create: `src/hooks/useUsage.ts`

**Interfaces:**
- Consumes: `parseSnapshot`, `UsageRow` from `usageRules.ts`; RPC `usage_snapshot`; realtime on `usage_counters`.
- Produces: `useUsage(orgId: string | null): { rows: UsageRow[]; loading: boolean; error: string | null; reload: () => void }`

- [ ] **Step 1: Write the hook**

Create `src/hooks/useUsage.ts`:

```ts
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseSnapshot, type UsageRow } from '../../supabase/functions/_shared/usageRules';

const POLL_MS = 60_000;

/**
 * The organisation's worker allowances for today, kept fresh by a 60 s refetch and by realtime changes to its
 * counters. The channel name includes useId() so two mounted users of this hook (the top-bar meter and the Settings
 * card) never share a channel. A failed refetch keeps the last good numbers; "Usage unavailable" is only reported
 * when nothing has ever loaded.
 */
export function useUsage(orgId: string | null) {
  const instance = useId();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const hasRows = useRef(false);

  useEffect(() => {
    hasRows.current = false;
    setRows([]);
    setError(null);
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    let active = true;
    const load = async () => {
      const { data, error: err } = await supabase.rpc('usage_snapshot', { p_org: orgId });
      if (!active) return;
      const parsed = err ? [] : parseSnapshot(data);
      if (err) console.error('usage_snapshot failed:', err.message);
      if (parsed.length > 0) {
        hasRows.current = true;
        setRows(parsed);
        setError(null);
      } else if (!hasRows.current) {
        setError('Usage unavailable');
      }
      setLoading(false);
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    const channel = supabase
      .channel(`usage-${orgId}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'usage_counters', filter: `org_id=eq.${orgId}` }, () => void load())
      .subscribe();
    return () => { active = false; window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [orgId, instance, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { rows, loading, error, reload };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useUsage.ts
git commit -m "feat: useUsage hook (snapshot, polling, realtime with per-instance channel)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The usage meter in the top bar

**Files:**
- Create: `src/components/layout/UsageMeter.tsx`
- Modify: `src/components/layout/TopBar.tsx` (import and the line `<ThemeToggle />` near line 25)

**Interfaces:**
- Consumes: `useUsage` (Task 6), `useOrg`, `fetchHunterAllowance` / `hunterAllowanceText` / `HunterAllowance` from `src/lib/deepFind.ts` (Task 5 adds `resetDate`), and from `usageRules.ts`: `chipText`, `formatRenewalDate`, `formatResetLine`, `stateLine`, `tightestAllowance`, `usageState`, `USAGE_TEXT`, `UsageState`.
- Produces: `<UsageMeter />` (no props).

- [ ] **Step 1: Write the component**

Create `src/components/layout/UsageMeter.tsx`:

```tsx
import { useEffect, useId, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useOrg } from '../../hooks/useOrg';
import { useUsage } from '../../hooks/useUsage';
import { fetchHunterAllowance, hunterAllowanceText, type HunterAllowance } from '../../lib/deepFind';
import {
  chipText, formatRenewalDate, formatResetLine, stateLine, tightestAllowance, usageState, USAGE_TEXT, type UsageState,
} from '../../../supabase/functions/_shared/usageRules';

const CHIP_CLASS: Record<UsageState | 'quiet', string> = {
  ok: 'border-line text-muted hover:text-offwhite',
  warning: 'border-warning text-warning',
  full: 'border-danger text-danger',
  shared_full: 'border-danger text-danger',
  quiet: 'border-line text-muted',
};
const ROW_CLASS: Record<UsageState, string> = { ok: 'text-muted', warning: 'text-warning', full: 'text-danger', shared_full: 'text-danger' };

type HunterState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; value: HunterAllowance | null };

/**
 * Top-bar usage meter. The chip names the allowance closest to running out (in words; colour only reinforces it).
 * The panel lists every allowance with its reset time, opens on hover, keyboard focus and tap, and closes with Escape.
 * Hunter's monthly allowance is fetched once, the first time the panel opens, and only when the organisation has a key.
 */
export function UsageMeter() {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const { rows, loading, error } = useUsage(orgId);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [hunter, setHunter] = useState<HunterState>({ status: 'idle' });
  const open = hovered || focused || pinned;

  useEffect(() => { setHunter({ status: 'idle' }); }, [orgId]);

  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !orgId || hunter.status !== 'idle') return;
    setHunter({ status: 'loading' });
    let live = true;
    void fetchHunterAllowance(orgId).then((value) => { if (live) setHunter({ status: 'done', value }); });
    return () => { live = false; };
  }, [open, orgId, hunter.status]);

  const tight = tightestAllowance(rows);
  const state: UsageState | 'quiet' = tight ? usageState(tight) : 'quiet';
  const label = loading ? 'Usage…' : error || !tight ? 'Usage unavailable' : chipText(tight);
  const announce = tight && state !== 'ok' && state !== 'quiet' ? chipText(tight) : '';
  const resetsAt = rows[0] ? new Date(rows[0].resetsAt) : null;

  function closeAll() { setHovered(false); setFocused(false); setPinned(false); }

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) { setFocused(false); setPinned(false); } }}
      onKeyDown={(e) => { if (e.key === 'Escape') { closeAll(); (e.target as HTMLElement).blur?.(); } }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}. Show usage details`}
        onClick={() => setPinned((p) => !p)}
        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-semibold ${CHIP_CLASS[state]}`}
      >
        <Zap className="h-4 w-4 shrink-0" aria-hidden />
        <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      </button>
      <span role="status" className="sr-only">{announce}</span>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Worker usage today"
          className="absolute right-0 top-full z-30 mt-2 w-80 max-w-[90vw] rounded-xl border border-line bg-card p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Lookup worker, today</p>
          {error || rows.length === 0 ? (
            <p className="text-sm text-muted">Usage could not be loaded right now.</p>
          ) : (
            <ul className="flex flex-col">
              {rows.map((row) => {
                const s = usageState(row);
                return (
                  <li key={row.resource} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-semibold">{USAGE_TEXT[row.resource].label}</span>
                      <span className={`text-sm font-semibold ${ROW_CLASS[s]}`}>{row.used} / {row.limit}</span>
                    </div>
                    <p className={`text-xs ${ROW_CLASS[s]}`}>{stateLine(row)}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {resetsAt && !error && <p className="mt-1 border-t border-line pt-2 text-xs text-muted">{formatResetLine(now, resetsAt)}</p>}
          {hunter.status === 'loading' && <p className="mt-2 text-xs text-muted">Checking Hunter…</p>}
          {hunter.status === 'done' && hunter.value?.configured && (
            <p className={`mt-2 text-xs ${hunter.value.usedUp ? 'text-danger' : 'text-muted'}`}>
              {hunterAllowanceText(hunter.value) ?? 'Hunter allowance could not be read.'}
              {formatRenewalDate(hunter.value.resetDate) ? ` Renews ${formatRenewalDate(hunter.value.resetDate)}.` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount it in the top bar**

In `src/components/layout/TopBar.tsx` add `import { UsageMeter } from './UsageMeter';` after the `ThemeToggle` import, and change

```tsx
      <ThemeToggle />
      <OrgSwitcher />
```

to

```tsx
      <ThemeToggle />
      <UsageMeter />
      <OrgSwitcher />
```

- [ ] **Step 3: Type-check, test and build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors, all tests pass, build succeeds (the known 500 kB chunk warning is fine).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/UsageMeter.tsx src/components/layout/TopBar.tsx
git commit -m "feat: top-bar usage meter (tightest allowance chip, hover/focus/tap panel)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Admin limits card in Settings

**Files:**
- Create: `src/components/settings/UsageLimitsCard.tsx`
- Modify: `src/pages/Settings.tsx` (add the import near line 16 and render the card next to the other cards near line 97)

**Interfaces:**
- Consumes: `useUsage` (with `reload`), `parseLimitInput`, `USAGE_DEFAULTS`, `USAGE_RESOURCES`, `USAGE_TEXT`, `usageState`, `MAX_ORG_LIMIT`, `UsageResource` from `usageRules.ts`; table `usage_limits` (admin insert/update/delete by RLS).
- Produces: `<UsageLimitsCard orgId={string} isOrgAdmin={boolean} />`

- [ ] **Step 1: Write the card**

Create `src/components/settings/UsageLimitsCard.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useUsage } from '../../hooks/useUsage';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Skeleton } from '../ui/Skeleton';
import {
  MAX_ORG_LIMIT, parseLimitInput, USAGE_DEFAULTS, USAGE_TEXT, usageState, type UsageResource,
} from '../../../supabase/functions/_shared/usageRules';

type Saving = { resource: UsageResource; kind: 'save' | 'reset' } | null;

/**
 * Per-organisation daily limits for the shared lookup worker. Everyone in the organisation can see them; only an
 * organisation admin can change them (RLS is the real gate). The shared worker-wide allowance always wins, whatever is
 * typed here.
 */
export function UsageLimitsCard({ orgId, isOrgAdmin }: { orgId: string; isOrgAdmin: boolean }) {
  const { rows, loading, error, reload } = useUsage(orgId);
  const [drafts, setDrafts] = useState<Partial<Record<UsageResource, string>>>({});
  const [saving, setSaving] = useState<Saving>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { setDrafts({}); setMessage(null); }, [orgId]);

  async function save(resource: UsageResource) {
    const text = drafts[resource];
    if (text === undefined) return;
    const row = rows.find((r) => r.resource === resource);
    if (row && text.trim() === String(row.limit)) { setDrafts((d) => { const { [resource]: _unused, ...rest } = d; return rest; }); return; }
    const value = parseLimitInput(text);
    if (value === null) {
      setMessage({ ok: false, text: `Enter a whole number from 0 to ${MAX_ORG_LIMIT} for ${USAGE_TEXT[resource].label.toLowerCase()}.` });
      return;
    }
    setSaving({ resource, kind: 'save' });
    const { error: err } = await supabase.from('usage_limits').upsert({ org_id: orgId, resource, daily_limit: value }, { onConflict: 'org_id,resource' });
    setSaving(null);
    if (err) {
      console.error('usage limit save failed:', err.message);
      setMessage({ ok: false, text: 'Could not save that limit. Only an organisation admin can change limits.' });
      return;
    }
    setDrafts((d) => { const { [resource]: _unused, ...rest } = d; return rest; });
    setMessage({ ok: true, text: `${USAGE_TEXT[resource].label} limit saved: ${value} a day.` });
    reload();
  }

  async function reset(resource: UsageResource) {
    setSaving({ resource, kind: 'reset' });
    const { error: err } = await supabase.from('usage_limits').delete().eq('org_id', orgId).eq('resource', resource);
    setSaving(null);
    if (err) {
      console.error('usage limit reset failed:', err.message);
      setMessage({ ok: false, text: 'Could not reset that limit.' });
      return;
    }
    setDrafts((d) => { const { [resource]: _unused, ...rest } = d; return rest; });
    setMessage({ ok: true, text: `${USAGE_TEXT[resource].label} limit reset to the default of ${USAGE_DEFAULTS[resource].orgLimit} a day.` });
    reload();
  }

  if (loading) return <Skeleton className="h-48 w-full max-w-xl" />;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-bold">Lookup worker limits</h2>
        <p className="text-sm text-muted">
          How much of the shared lookup worker (site scrapes, email checks, page fetches) this organisation can use each day.
          Limits reset at 00:00 UK time. The shared worker allowance is split across all organisations and always wins, so a
          higher number here cannot get past it.
        </p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!error && rows.map((row) => {
          const s = usageState(row);
          const isDefault = row.limit === USAGE_DEFAULTS[row.resource].orgLimit;
          const busy = saving?.resource === row.resource;
          return (
            <div key={row.resource} className="flex flex-col gap-1.5 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <Input
                    label={`${USAGE_TEXT[row.resource].label} per day`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_ORG_LIMIT}
                    value={drafts[row.resource] ?? String(row.limit)}
                    disabled={!isOrgAdmin || busy}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.resource]: e.target.value }))}
                    onBlur={() => void save(row.resource)}
                  />
                </div>
                {isOrgAdmin && !isDefault && (
                  <Button variant="ghost" loading={busy && saving?.kind === 'reset'} onClick={() => void reset(row.resource)}>
                    Reset to {USAGE_DEFAULTS[row.resource].orgLimit}
                  </Button>
                )}
              </div>
              <p className={`text-xs ${s === 'ok' ? 'text-muted' : s === 'warning' ? 'text-warning' : 'text-danger'}`}>
                Used today: {row.used} of {row.limit}. Shared worker allowance: {row.globalUsed} of {row.globalLimit} used today.
              </p>
            </div>
          );
        })}
        {!isOrgAdmin && <p className="text-xs text-muted">Only an organisation admin can edit these.</p>}
        {message && <p role="status" className={`text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Render it in Settings**

In `src/pages/Settings.tsx` add

```tsx
import { UsageLimitsCard } from '../components/settings/UsageLimitsCard';
```

after the `CustomPlaceholdersCard` import, and add this line directly after the `CustomPlaceholdersCard` render line (`{currentOrg && <CustomPlaceholdersCard ... />}`):

```tsx
      {currentOrg && <UsageLimitsCard orgId={currentOrg.id} isOrgAdmin={currentOrg.role === 'admin'} />}
```

- [ ] **Step 3: Type-check, test and build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: no type errors, all tests pass, build succeeds. If `noUnusedLocals` flags the `_unused` destructuring, replace each `const { [resource]: _unused, ...rest } = d; return rest;` with `const rest = { ...d }; delete rest[resource]; return rest;`.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/UsageLimitsCard.tsx src/pages/Settings.tsx
git commit -m "feat: Settings card for per-organisation worker limits (admin edit, reset to default)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Browser verification, docs and final checks

**Files:**
- Modify: `CLAUDE.md` (Current Status), `docs/AUTOMATIONS.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Full automated check**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green. Record the test count.

- [ ] **Step 2: Browser check (needs Kevin signed in)**

The automation browser is signed out of the app and cannot type passwords, so ask Kevin to run `npm run dev`, sign in at `http://localhost:5173` in the Chrome profile the browser tools control, and tell you when done. Then check, taking a screenshot of each:
1. Top bar shows the chip between the theme toggle and the organisation switcher, text like "Site scrapes: 100 left" (the first resource when all are equal ratio).
2. Hover opens the panel; moving away closes it; Tab to the chip opens it; Escape closes it; click pins it open and a second click closes it.
3. Panel lists the three resources with `used / limit`, the line "Resets at 00:00 UK time (in …)", and a Hunter line only if the organisation has a Hunter key (with "Renews …" only if Hunter returned a date).
4. At 400 px width the chip shows only the icon and the panel stays inside the screen (no horizontal scroll).
5. Light and dark themes both readable; check the amber and red states by temporarily setting a low limit in Settings (for example 3 site scrapes) and using the **Use up** step below.
6. Settings page shows the "Lookup worker limits" card; typing 999999 shows the validation message; typing 60 and leaving the field saves and the chip updates within a few seconds; "Reset to 100" restores the default.
7. A contractor (non-admin) sees the card read-only.

To see the amber/red states without the worker existing in the app yet, use the service role through the Management API the same way the concurrency script does: reserve units for the organisation (for example 85 of 100 site scrapes), look at the chip, then restore with `usage_refund` for the same count and `DELETE FROM usage_limits` for any test limit. Record that you restored the counters.

- [ ] **Step 3: Contrast check**

Use the `mcp__plugin_accesslint_accesslint__calculate_contrast_ratio` tool for the three chip colours against the top-bar background in both themes (tokens `--color-warning`, `--color-danger`, `--color-muted` against `--color-bg`). Each must be at least 4.5:1. If one is not, use the existing accessible token pair for that theme rather than inventing a new colour, and note it.

- [ ] **Step 4: Update the docs**

In `CLAUDE.md`, add a new entry at the end of "Current Status" (after the latest session entry) titled "Usage and quotas (2026-10-14)". It must state: what was built (tables, three functions, meter, Settings card), the caps table (100/400, 150/300, 300/1000), reset at 00:00 Europe/London, the fail-closed rule, that `reserveUsage`/`refundUsage` in `_shared/usage.ts` are what sub-project C must call before every worker request (and refund when the worker did no work), the audit results table from Task 3 with PASS counts, the concurrency result, the four deliberate spec changes listed at the top of this plan, and the open items (Hunter `reset_date` shape unverified; AI call counting and Firecrawl allowance deferred; sub-projects B and C not started).

In `docs/AUTOMATIONS.md`, add a row or section "Worker usage limits" listing: trigger (every worker call, once C lands), what it changes (`usage_counters`, `usage_global_counters`), owner (Kevin), where to change limits (Settings, admins; shared caps in `usage_resources` via migration).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/AUTOMATIONS.md
git commit -m "docs: usage and quotas shipped (limits, audits, how sub-project C must call it)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Hand back**

Report to Kevin: what is live (migration applied, `run-deep-find` redeployed, front end built locally), what he must do (review, `git push origin HEAD:main`, and Cloudflare Pages deploys the front end), the audit results, and that sub-project B (jobs tracker and notification bar) is next.
