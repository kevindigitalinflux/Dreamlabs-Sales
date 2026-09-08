# Analytics Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/analytics` `ComingSoon` placeholder with a real, org-scoped analytics dashboard covering pipeline health (leads by stage/vertical/contractor, conversion funnel, won deals) and outreach performance (emails, sequences, LinkedIn, scraper yield, autopilot spend), with three fixed time-range presets.

**Architecture:** Pure aggregation functions in `src/lib/analytics.ts` (unit-tested, no I/O) consume raw rows fetched once per org by a new `useAnalytics` hook; the hook recomputes via `useMemo` when the selected period changes, without refetching. Two new presentational sections (`PipelineSection`, `OutreachSection`) render the computed data through two small `recharts` wrapper components (`BarChart`, `DonutChart`). No new database tables, views, RPCs, or RLS policies — every query reads exactly what each table's existing RLS already returns for the caller (org-wide for admins, own-rows-only for non-admins on `leads`/`email_logs`/`sequence_enrollments`/`scrape_jobs`; already org-wide for everyone on `email_replies`/`linkedin_drafts`/`autopilot_runs`).

**Tech Stack:** React 18 + TypeScript, Supabase (Postgres + RLS), Tailwind, `recharts` (new dependency, first chart library in this app), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-analytics-design.md` (read this in full — it has the exact definitions for the conversion funnel, won-deals period scoping, and every period-bound metric; this plan implements it verbatim).

## Global Constraints

- No `any` — cast to `unknown` first if needed. Strict TypeScript throughout.
- Named exports only, no default exports.
- Tailwind utility classes only — no custom CSS or inline styles (recharts chart internals are the one exception — they take inline style objects/props by design, per the library's own API; this does not violate the "no inline styles" rule, which is about this app's own JSX).
- Every component must handle loading, error, and empty states.
- Keep components under ~150 lines — split further if a task's file would exceed this.
- Charts are bar and donut only — no line/time-series charts (per the spec's explicit constraint).
- No new database tables, views, RPCs, or migrations. No RLS policy changes anywhere.
- The funnel and "leads by X" breakdowns are snapshots (not period-filtered); "won deals", "emails sent + reply rate", "LinkedIn sent", "scraper yield", and "autopilot spend" ARE period-filtered — see the spec's Data Model table for exactly which.
- "Leads by contractor" only renders for `currentOrg.role === 'admin'`. Both section headers show a one-line caption to non-admin viewers ("Showing your own activity. Admins see the whole org.") — see spec §3.

---

### Task 1: Chart wrapper components + recharts dependency

**Files:**
- Create: `src/components/analytics/BarChart.tsx`
- Create: `src/components/analytics/DonutChart.tsx`
- Modify: `package.json` (add `recharts` dependency)

**Interfaces:**
- Consumes: nothing project-specific.
- Produces: `ChartDatum` (`{ label: string; value: number }`), `BarChart({ data: ChartDatum[]; color?: string })`, `DonutChart({ data: ChartDatum[]; colors?: string[] })` — both default-exported never, named exports only. Every later task that renders a chart imports these two components and maps its own domain data into `ChartDatum[]` first.

- [ ] **Step 1: Install recharts**

Run: `npm install recharts`

This app is on React 19.2.7; recharts' current major (3.x) declares `react`/`react-dom` peer support for `^19.0.0`, so this resolves cleanly with no `--legacy-peer-deps` needed.

- [ ] **Step 2: Write the BarChart wrapper**

```tsx
import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ChartDatum {
  label: string;
  value: number;
}

/** Single-series bar chart matching this app's dark palette (SPEC.md §11 tokens, hardcoded since recharts needs real hex/rgba, not Tailwind classes). */
export function BarChart({ data, color = '#00DFDF' }: { data: ChartDatum[]; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'rgba(244,244,248,0.55)', fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: 'rgba(244,244,248,0.55)', fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          contentStyle={{ background: '#111C6A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F4F4F8' }}
        />
        <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} />
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Write the DonutChart wrapper**

```tsx
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { ChartDatum } from './BarChart';

const DEFAULT_COLORS = ['#8B32FF', '#00DFDF', '#F0386B', '#64378B', '#F59E0B', '#22C55E', '#EF4444', '#94A3B8'];

/** Donut chart matching this app's dark palette. Falls back through DEFAULT_COLORS if data has more series than colors provided. */
export function DonutChart({ data, colors = DEFAULT_COLORS }: { data: ChartDatum[]; colors?: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ background: '#111C6A', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#F4F4F8' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(244,244,248,0.55)' }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

These are pure presentational components with no project-specific logic — no unit test file (matches this codebase's existing convention: `Card`/`Skeleton`/`EmptyState`/`MultiSelect` have none either, only files under `src/lib/` and a couple of pure-logic component helpers do). Verification happens visually once Task 4/5 render real charts through them — no standalone verification needed for this task beyond the type-check.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/analytics/BarChart.tsx src/components/analytics/DonutChart.tsx
git commit -m "feat: add recharts + BarChart/DonutChart wrapper components"
```

---

### Task 2: Pure aggregation functions (`src/lib/analytics.ts`) + unit tests

**Files:**
- Create: `src/lib/analytics.ts`
- Test: `src/lib/analytics.test.ts`

**Interfaces:**
- Consumes: `STAGES`, `stageInfo` from `../lib/utils`; `Lead`, `LeadNote`, `Stage`, `EnrollmentStatus` from `../types`.
- Produces: `AnalyticsPeriod`, `periodStart`, `inPeriod`, `parseStageChanges`, `computeLeadsByStage`, `computeLeadsByVertical`, `computeLeadsByContractor`, `computeFunnel`, `computeWonDeals`, `computeEmailStats`, `computeSequenceStatusBreakdown`, `computeLinkedinSent`, `computeScraperYield`, `computeAutopilotSpendCents` — every later task's `useAnalytics` hook (Task 3) imports and calls all of these with exactly these names and signatures.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/analytics.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  computeAutopilotSpendCents, computeEmailStats, computeFunnel, computeLeadsByContractor,
  computeLeadsByStage, computeLeadsByVertical, computeLinkedinSent, computeScraperYield,
  computeSequenceStatusBreakdown, computeWonDeals, inPeriod, periodStart,
} from './analytics';
import type { Lead, LeadNote } from '../types';

const NOW = new Date(2026, 8, 15, 12, 0, 0); // 15 Sept 2026, noon

function makeLead(overrides: Partial<Lead>): Lead {
  return {
    id: crypto.randomUUID(),
    business_name: 'Acme Ltd', owner_name: null, phone: null, email: null,
    website: null, address: null, city: null, postcode: null,
    google_rating: null, review_count: null, vertical: null,
    stage: 'new_lead', package_tier: null, deal_value: null,
    assigned_to: null, created_by: null, raw_lead_id: null,
    next_action_date: null, next_action_note: null, is_priority: false,
    call_count: 0, last_contacted_at: null, kanban_position: 0,
    created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function makeNote(overrides: Partial<LeadNote>): LeadNote {
  return {
    id: crypto.randomUUID(), lead_id: 'lead-1', created_by: null,
    content: '', note_type: 'general', ai_extracted_data: null,
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('periodStart / inPeriod', () => {
  it('this_month starts on the 1st of the current month', () => {
    expect(periodStart('this_month', NOW)).toEqual(new Date(2026, 8, 1));
  });
  it('last_30_days is exactly 30 days back', () => {
    const start = periodStart('last_30_days', NOW)!;
    expect(NOW.getTime() - start.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it('all_time has no lower bound', () => {
    expect(periodStart('all_time', NOW)).toBeNull();
  });
  it('inPeriod excludes dates before the period start', () => {
    expect(inPeriod('2026-07-31T00:00:00Z', 'this_month', NOW)).toBe(false);
    expect(inPeriod('2026-09-01T00:00:00Z', 'this_month', NOW)).toBe(true);
  });
  it('inPeriod excludes dates after now', () => {
    expect(inPeriod('2026-09-20T00:00:00Z', 'this_month', NOW)).toBe(false);
  });
  it('all_time includes anything up to now', () => {
    expect(inPeriod('2020-01-01T00:00:00Z', 'all_time', NOW)).toBe(true);
  });
});

describe('computeLeadsByStage', () => {
  it('counts leads per stage, all 8 stages present even at 0', () => {
    const leads = [makeLead({ stage: 'contacted' }), makeLead({ stage: 'contacted' }), makeLead({ stage: 'won' })];
    const result = computeLeadsByStage(leads);
    expect(result).toHaveLength(8);
    expect(result.find((r) => r.stage === 'contacted')!.count).toBe(2);
    expect(result.find((r) => r.stage === 'won')!.count).toBe(1);
    expect(result.find((r) => r.stage === 'lost')!.count).toBe(0);
  });
});

describe('computeLeadsByVertical', () => {
  it('groups null vertical under Unspecified, sorted by count desc', () => {
    const leads = [
      makeLead({ vertical: 'Dental' }), makeLead({ vertical: 'Dental' }),
      makeLead({ vertical: null }), makeLead({ vertical: 'Retail' }),
    ];
    const result = computeLeadsByVertical(leads);
    expect(result[0]).toEqual({ vertical: 'Dental', count: 2 });
    expect(result.find((r) => r.vertical === 'Unspecified')!.count).toBe(1);
  });
});

describe('computeLeadsByContractor', () => {
  it('groups unassigned leads under a synthetic bucket, resolves names via the callback', () => {
    const leads = [
      makeLead({ assigned_to: 'u1' }), makeLead({ assigned_to: 'u1' }), makeLead({ assigned_to: null }),
    ];
    const nameFor = (id: string) => (id === 'u1' ? 'Kevin' : id);
    const result = computeLeadsByContractor(leads, nameFor);
    expect(result.find((r) => r.contractorId === 'u1')).toEqual({ contractorId: 'u1', contractorName: 'Kevin', count: 2 });
    expect(result.find((r) => r.contractorId === 'unassigned')).toEqual({ contractorId: 'unassigned', contractorName: 'Unassigned', count: 1 });
  });
});

describe('computeFunnel', () => {
  it('a lead currently at a stage with no history still counts as having reached it', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'proposal_sent' });
    const funnel = computeFunnel([lead], new Map());
    expect(funnel.find((f) => f.stage === 'proposal_sent')!.count).toBe(1);
  });
  it('a lead that regressed after reaching a stage still counts as having reached it', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'lost' });
    const notes = [
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: New Lead → Contacted' }),
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: Contacted → Proposal Sent' }),
      makeNote({ lead_id: 'lead-1', content: 'Stage changed: Proposal Sent → Lost' }),
    ];
    const funnel = computeFunnel([lead], new Map([['lead-1', notes]]));
    expect(funnel.find((f) => f.stage === 'contacted')!.count).toBe(1);
    expect(funnel.find((f) => f.stage === 'proposal_sent')!.count).toBe(1);
    expect(funnel.find((f) => f.stage === 'won')!.count).toBe(0);
  });
  it('a lead still at new_lead with no notes reaches nothing in the funnel', () => {
    const lead = makeLead({ id: 'lead-1', stage: 'new_lead' });
    const funnel = computeFunnel([lead], new Map());
    expect(funnel.every((f) => f.count === 0)).toBe(true);
  });
  it('conversionFromPrevious is null for the first stage, a ratio for the rest', () => {
    const leads = [
      makeLead({ id: 'l1', stage: 'won' }),
      makeLead({ id: 'l2', stage: 'contacted' }),
    ];
    const notes = new Map([
      ['l1', [
        makeNote({ lead_id: 'l1', content: 'Stage changed: New Lead → Contacted' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Contacted → Audit Booked' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Audit Booked → Proposal Sent' }),
        makeNote({ lead_id: 'l1', content: 'Stage changed: Proposal Sent → Won' }),
      ]],
    ]);
    const funnel = computeFunnel(leads, notes);
    expect(funnel[0]!.conversionFromPrevious).toBeNull();
    expect(funnel.find((f) => f.stage === 'contacted')!.count).toBe(2);
    expect(funnel.find((f) => f.stage === 'won')!.conversionFromPrevious).toBe(0.5); // 1 of 2 that reached proposal_sent won
  });
});

describe('computeWonDeals', () => {
  it('only counts leads that transitioned to won within the period, not ones merely currently won', () => {
    const oldWin = makeLead({ id: 'l1', stage: 'won', deal_value: 1000 });
    const newWin = makeLead({ id: 'l2', stage: 'won', deal_value: 2000 });
    const notes = new Map([
      ['l1', [makeNote({ lead_id: 'l1', content: 'Stage changed: Proposal Sent → Won', created_at: '2026-06-01T00:00:00Z' })]],
      ['l2', [makeNote({ lead_id: 'l2', content: 'Stage changed: Proposal Sent → Won', created_at: '2026-09-10T00:00:00Z' })]],
    ]);
    const result = computeWonDeals([oldWin, newWin], notes, 'this_month', NOW);
    expect(result).toEqual({ count: 1, totalValue: 2000 });
  });
  it('a lead currently won with no won-transition note in period is excluded even at all_time if the note predates it', () => {
    const lead = makeLead({ id: 'l1', stage: 'won', deal_value: 500 });
    const notes = new Map([['l1', [] as LeadNote[]]]); // no note at all — e.g. created directly as won
    const result = computeWonDeals([lead], notes, 'all_time', NOW);
    expect(result).toEqual({ count: 0, totalValue: 0 });
  });
});

describe('computeEmailStats', () => {
  it('counts sent emails and replies within the period, computes reply rate', () => {
    const logs = [
      { status: 'sent', sent_at: '2026-09-10T00:00:00Z' },
      { status: 'sent', sent_at: '2026-09-12T00:00:00Z' },
      { status: 'draft', sent_at: '2026-09-12T00:00:00Z' },
      { status: 'sent', sent_at: '2026-07-01T00:00:00Z' }, // outside this_month
    ];
    const replies = [{ received_at: '2026-09-11T00:00:00Z' }];
    const result = computeEmailStats(logs, replies, 'this_month', NOW);
    expect(result).toEqual({ sent: 2, replies: 1, replyRate: 0.5 });
  });
  it('reply rate is 0, not NaN, when nothing was sent', () => {
    expect(computeEmailStats([], [], 'this_month', NOW).replyRate).toBe(0);
  });
});

describe('computeSequenceStatusBreakdown', () => {
  it('always returns all 4 statuses, even at 0', () => {
    const result = computeSequenceStatusBreakdown([{ status: 'active' }, { status: 'active' }]);
    expect(result).toHaveLength(4);
    expect(result.find((r) => r.status === 'active')!.count).toBe(2);
    expect(result.find((r) => r.status === 'paused')!.count).toBe(0);
  });
});

describe('computeLinkedinSent', () => {
  it('counts only sent drafts with sent_at inside the period', () => {
    const drafts = [
      { status: 'sent', sent_at: '2026-09-10T00:00:00Z' },
      { status: 'drafted', sent_at: null },
      { status: 'sent', sent_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeLinkedinSent(drafts, 'this_month', NOW)).toBe(1);
  });
});

describe('computeScraperYield', () => {
  it('sums results_count and approved_count for jobs created in the period', () => {
    const jobs = [
      { results_count: 40, approved_count: 12, created_at: '2026-09-05T00:00:00Z' },
      { results_count: 20, approved_count: 5, created_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeScraperYield(jobs, 'this_month', NOW)).toEqual({ found: 40, approved: 12 });
  });
});

describe('computeAutopilotSpendCents', () => {
  it('sums spend for runs started in the period', () => {
    const runs = [
      { actual_ai_cost_cents: 500, started_at: '2026-09-05T00:00:00Z' },
      { actual_ai_cost_cents: 300, started_at: '2026-07-01T00:00:00Z' },
    ];
    expect(computeAutopilotSpendCents(runs, 'this_month', NOW)).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: FAIL — `./analytics` module not found (no implementation exists yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/analytics.ts`:

```typescript
import { STAGES, stageInfo } from './utils';
import type { EnrollmentStatus, Lead, LeadNote, Stage } from '../types';

export type AnalyticsPeriod = 'this_month' | 'last_30_days' | 'all_time';

/** Start of the given period, or null for 'all_time' (no lower bound). */
export function periodStart(period: AnalyticsPeriod, now: Date = new Date()): Date | null {
  if (period === 'all_time') return null;
  if (period === 'last_30_days') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** True if the ISO date falls within [periodStart, now]. */
export function inPeriod(dateISO: string, period: AnalyticsPeriod, now: Date = new Date()): boolean {
  const start = periodStart(period, now);
  const d = new Date(dateISO);
  if (start && d < start) return false;
  return d <= now;
}

export interface StageCount { stage: Stage; count: number; }

/** Snapshot count of leads currently in each pipeline stage, in pipeline order, all 8 always present. */
export function computeLeadsByStage(leads: Lead[]): StageCount[] {
  return STAGES.map((s) => ({ stage: s.value, count: leads.filter((l) => l.stage === s.value).length }));
}

export interface VerticalCount { vertical: string; count: number; }

/** Snapshot count of leads by vertical; null groups under "Unspecified"; sorted highest count first. */
export function computeLeadsByVertical(leads: Lead[]): VerticalCount[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = lead.vertical ?? 'Unspecified';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([vertical, count]) => ({ vertical, count })).sort((a, b) => b.count - a.count);
}

export interface ContractorCount { contractorId: string; contractorName: string; count: number; }

/** Snapshot count of leads by assignee; unassigned leads group under contractorId 'unassigned'. */
export function computeLeadsByContractor(leads: Lead[], nameFor: (id: string) => string): ContractorCount[] {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const key = lead.assigned_to ?? 'unassigned';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([contractorId, count]) => ({
      contractorId,
      contractorName: contractorId === 'unassigned' ? 'Unassigned' : nameFor(contractorId),
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

const FUNNEL_STAGES: Stage[] = ['contacted', 'audit_booked', 'proposal_sent', 'won'];
const STAGE_CHANGE_PREFIX = 'Stage changed: ';

interface StageChange { toLabel: string; createdAt: string; }

/** Parses "Stage changed: {from} → {to}" general notes (src/lib/leadUpdates.ts) into their target label + timestamp. */
export function parseStageChanges(notes: LeadNote[]): StageChange[] {
  return notes
    .filter((n) => n.note_type === 'general' && n.content.startsWith(STAGE_CHANGE_PREFIX))
    .map((n) => {
      const rest = n.content.slice(STAGE_CHANGE_PREFIX.length);
      const to = rest.split(' → ')[1] ?? '';
      return { toLabel: to.trim(), createdAt: n.created_at };
    });
}

function reachedStage(lead: Lead, stage: Stage, changes: StageChange[]): boolean {
  if (lead.stage === stage) return true;
  const label = stageInfo(stage).label;
  return changes.some((c) => c.toLabel === label);
}

export interface FunnelStep { stage: Stage; count: number; conversionFromPrevious: number | null; }

/** Conversion funnel contacted -> audit_booked -> proposal_sent -> won. Snapshot, not period-scoped (see spec). */
export function computeFunnel(leads: Lead[], notesByLead: Map<string, LeadNote[]>): FunnelStep[] {
  const counts = FUNNEL_STAGES.map((stage) => ({
    stage,
    count: leads.filter((lead) => reachedStage(lead, stage, parseStageChanges(notesByLead.get(lead.id) ?? []))).length,
  }));
  return counts.map((c, i) => ({
    ...c,
    conversionFromPrevious: i === 0 ? null : counts[i - 1]!.count === 0 ? 0 : c.count / counts[i - 1]!.count,
  }));
}

export interface WonDeals { count: number; totalValue: number; }

/** Leads that transitioned to 'won' within the given period — not leads merely currently 'won' (see spec). */
export function computeWonDeals(
  leads: Lead[],
  notesByLead: Map<string, LeadNote[]>,
  period: AnalyticsPeriod,
  now: Date = new Date(),
): WonDeals {
  const wonLabel = stageInfo('won').label;
  let count = 0;
  let totalValue = 0;
  for (const lead of leads) {
    if (lead.stage !== 'won') continue;
    const changes = parseStageChanges(notesByLead.get(lead.id) ?? []);
    const wonInPeriod = changes.some((c) => c.toLabel === wonLabel && inPeriod(c.createdAt, period, now));
    if (wonInPeriod) {
      count += 1;
      totalValue += lead.deal_value ?? 0;
    }
  }
  return { count, totalValue };
}

export interface EmailStats { sent: number; replies: number; replyRate: number; }

/** sent = email_logs with status 'sent' in period; replies = email_replies received in period (activity ratio, not strict cohort attribution — see spec). */
export function computeEmailStats(
  logs: { status: string; sent_at: string }[],
  replies: { received_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): EmailStats {
  const sent = logs.filter((l) => l.status === 'sent' && inPeriod(l.sent_at, period, now)).length;
  const replyCount = replies.filter((r) => inPeriod(r.received_at, period, now)).length;
  return { sent, replies: replyCount, replyRate: sent === 0 ? 0 : replyCount / sent };
}

export interface SequenceStatusCount { status: EnrollmentStatus; count: number; }

const ENROLLMENT_STATUSES: EnrollmentStatus[] = ['active', 'paused', 'completed', 'cancelled'];

/** Snapshot count of sequence enrollments by current status; all 4 statuses always present, possibly 0. */
export function computeSequenceStatusBreakdown(enrollments: { status: EnrollmentStatus }[]): SequenceStatusCount[] {
  return ENROLLMENT_STATUSES.map((status) => ({
    status,
    count: enrollments.filter((e) => e.status === status).length,
  }));
}

/** Count of linkedin_drafts sent within the period. */
export function computeLinkedinSent(
  drafts: { status: string; sent_at: string | null }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): number {
  return drafts.filter((d) => d.status === 'sent' && d.sent_at !== null && inPeriod(d.sent_at, period, now)).length;
}

export interface ScraperYield { found: number; approved: number; }

/** Sums results_count/approved_count for scrape_jobs triggered (created_at) within the period. */
export function computeScraperYield(
  jobs: { results_count: number; approved_count: number; created_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): ScraperYield {
  const inRange = jobs.filter((j) => inPeriod(j.created_at, period, now));
  return {
    found: inRange.reduce((sum, j) => sum + j.results_count, 0),
    approved: inRange.reduce((sum, j) => sum + j.approved_count, 0),
  };
}

/** Sums actual_ai_cost_cents for autopilot_runs started within the period (spend-so-far counts toward the start period even if the run is still active). */
export function computeAutopilotSpendCents(
  runs: { actual_ai_cost_cents: number; started_at: string }[],
  period: AnalyticsPeriod,
  now: Date = new Date(),
): number {
  return runs.filter((r) => inPeriod(r.started_at, period, now)).reduce((sum, r) => sum + r.actual_ai_cost_cents, 0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/analytics.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npx vitest run`
Expected: all test files pass (48 pre-existing + this file's new tests).

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics.ts src/lib/analytics.test.ts
git commit -m "feat: add analytics aggregation functions with full unit test coverage"
```

---

### Task 3: `useAnalytics` hook

**Files:**
- Create: `src/hooks/useAnalytics.ts`

**Interfaces:**
- Consumes: `useOrg` (`../hooks/useOrg`, `currentOrg: { id: string; name: string; role: 'admin' | 'contractor' } | null`), `useProfiles` (`../hooks/useProfiles`, returns `{ profiles: (Profile & { role: Role })[] }`), `supabase` client, every `compute*` function and the `AnalyticsPeriod` type from Task 2's `src/lib/analytics.ts` (`parseStageChanges` is an internal helper `computeFunnel`/`computeWonDeals` call themselves — this task never calls it directly).
- Produces: `AnalyticsData` interface and `useAnalytics(period: AnalyticsPeriod): { data: AnalyticsData | null; loading: boolean; error: string | null }` — Tasks 4 and 5 import and destructure this hook's return value with these exact field names.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useAnalytics.ts`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useOrg } from './useOrg';
import { useProfiles } from './useProfiles';
import {
  computeAutopilotSpendCents, computeEmailStats, computeFunnel, computeLeadsByContractor,
  computeLeadsByStage, computeLeadsByVertical, computeLinkedinSent, computeScraperYield,
  computeSequenceStatusBreakdown, computeWonDeals,
} from '../lib/analytics';
import type {
  AnalyticsPeriod, ContractorCount, EmailStats, FunnelStep, ScraperYield,
  SequenceStatusCount, StageCount, VerticalCount, WonDeals,
} from '../lib/analytics';
import type { EnrollmentStatus, Lead, LeadNote } from '../types';

export interface AnalyticsData {
  leadsByStage: StageCount[];
  funnel: FunnelStep[];
  wonDeals: WonDeals;
  leadsByVertical: VerticalCount[];
  leadsByContractor: ContractorCount[] | null; // null for non-admins
  emailStats: EmailStats;
  sequenceStatusBreakdown: SequenceStatusCount[];
  linkedinSent: number;
  scraperYield: ScraperYield;
  autopilotSpendCents: number;
}

interface RawData {
  leads: Lead[];
  notesByLead: Map<string, LeadNote[]>;
  emailLogs: { status: string; sent_at: string }[];
  emailReplies: { received_at: string }[];
  enrollments: { status: EnrollmentStatus }[];
  linkedinDrafts: { status: string; sent_at: string | null }[];
  scrapeJobs: { results_count: number; approved_count: number; created_at: string }[];
  autopilotRuns: { actual_ai_cost_cents: number; started_at: string }[];
}

/**
 * Org-scoped analytics for the selected period. Fetches raw rows once per org (not per period —
 * every query already reads exactly what each table's RLS returns for the caller: org-wide for
 * admins, own-rows-only for non-admins on leads/email_logs/sequence_enrollments/scrape_jobs;
 * already org-wide for everyone on email_replies/linkedin_drafts/autopilot_runs — see
 * docs/superpowers/specs/2026-09-08-analytics-design.md §3), then recomputes via useMemo whenever
 * the period changes, with no additional network round-trip.
 */
export function useAnalytics(period: AnalyticsPeriod) {
  const { currentOrg } = useOrg();
  const { profiles } = useProfiles();
  const [raw, setRaw] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentOrg) { setRaw(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const [leadsRes, logsRes, repliesRes, enrollmentsRes, draftsRes, jobsRes, runsRes] = await Promise.all([
        supabase.from('leads').select('*').eq('org_id', currentOrg.id),
        supabase.from('email_logs').select('status, sent_at').eq('org_id', currentOrg.id),
        supabase.from('email_replies').select('received_at').eq('org_id', currentOrg.id),
        supabase.from('sequence_enrollments').select('status, leads!inner(org_id)').eq('leads.org_id', currentOrg.id),
        supabase.from('linkedin_drafts').select('status, sent_at').eq('org_id', currentOrg.id),
        supabase.from('scrape_jobs').select('results_count, approved_count, created_at').eq('org_id', currentOrg.id),
        supabase.from('autopilot_runs').select('actual_ai_cost_cents, started_at').eq('org_id', currentOrg.id),
      ]);

      const firstError = leadsRes.error ?? logsRes.error ?? repliesRes.error ?? enrollmentsRes.error
        ?? draftsRes.error ?? jobsRes.error ?? runsRes.error;
      if (firstError) {
        if (!cancelled) { setError(firstError.message); setLoading(false); }
        return;
      }

      const leads = (leadsRes.data ?? []) as Lead[];
      const leadIds = leads.map((l) => l.id);
      let notesByLead = new Map<string, LeadNote[]>();
      if (leadIds.length > 0) {
        const notesRes = await supabase
          .from('lead_notes').select('*').in('lead_id', leadIds);
        if (notesRes.error) {
          if (!cancelled) { setError(notesRes.error.message); setLoading(false); }
          return;
        }
        notesByLead = new Map();
        for (const note of (notesRes.data ?? []) as LeadNote[]) {
          const existing = notesByLead.get(note.lead_id) ?? [];
          existing.push(note);
          notesByLead.set(note.lead_id, existing);
        }
      }

      if (cancelled) return;
      setRaw({
        leads,
        notesByLead,
        emailLogs: (logsRes.data ?? []) as { status: string; sent_at: string }[],
        emailReplies: (repliesRes.data ?? []) as { received_at: string }[],
        enrollments: (enrollmentsRes.data ?? []) as { status: EnrollmentStatus }[],
        linkedinDrafts: (draftsRes.data ?? []) as { status: string; sent_at: string | null }[],
        scrapeJobs: (jobsRes.data ?? []) as { results_count: number; approved_count: number; created_at: string }[],
        autopilotRuns: (runsRes.data ?? []) as { actual_ai_cost_cents: number; started_at: string }[],
      });
      setError(null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [currentOrg]);

  const data = useMemo<AnalyticsData | null>(() => {
    if (!raw || !currentOrg) return null;
    return {
      leadsByStage: computeLeadsByStage(raw.leads),
      funnel: computeFunnel(raw.leads, raw.notesByLead),
      wonDeals: computeWonDeals(raw.leads, raw.notesByLead, period),
      leadsByVertical: computeLeadsByVertical(raw.leads),
      leadsByContractor: currentOrg.role === 'admin'
        ? computeLeadsByContractor(raw.leads, (id) => profiles.find((p) => p.id === id)?.full_name ?? profiles.find((p) => p.id === id)?.email ?? id)
        : null,
      emailStats: computeEmailStats(raw.emailLogs, raw.emailReplies, period),
      sequenceStatusBreakdown: computeSequenceStatusBreakdown(raw.enrollments),
      linkedinSent: computeLinkedinSent(raw.linkedinDrafts, period),
      scraperYield: computeScraperYield(raw.scrapeJobs, period),
      autopilotSpendCents: computeAutopilotSpendCents(raw.autopilotRuns, period),
    };
  }, [raw, period, currentOrg, profiles]);

  return { data, loading, error };
}
```

Note on the `sequence_enrollments` query: this table has no `org_id` column of its own (unlike `email_logs`/`scrape_jobs`/`linkedin_drafts`/`autopilot_runs`, which all do) — it's scoped only via its `lead_id` foreign key to `leads.org_id`. `leads!inner(org_id)` performs an inner join through that relationship so `.eq('leads.org_id', ...)` can filter on it, mirroring the embedded-resource query style `useProfiles.ts` already uses (`.select('role, profiles(*)')`).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification (deferred to Task 6)**

This hook has no UI of its own — its behavior is verified through Task 6's manual browser check, which exercises every field of `AnalyticsData` via the rendered page. No standalone test file (matches this codebase's convention: hooks that wrap Supabase calls, like `useLeads`/`useProfiles`/`useEmailSettings`, have no unit tests — only pure `lib/` functions do, which is why the aggregation logic itself lives in the separately-tested `analytics.ts`, not in this hook).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAnalytics.ts
git commit -m "feat: add useAnalytics hook (org-scoped, period-aware, RLS-honest)"
```

---

### Task 4: `PipelineSection` component

**Files:**
- Create: `src/components/analytics/PipelineSection.tsx`

**Interfaces:**
- Consumes: `AnalyticsData` type from `../../hooks/useAnalytics`; `BarChart`, `DonutChart`, `ChartDatum` from `./BarChart`/`./DonutChart` (Task 1); `stageInfo` from `../../lib/utils`; `formatCurrency` from `../../lib/utils` (already exists, confirmed in `src/lib/utils.ts:94`); `Card` from `../ui/Card`.
- Produces: `PipelineSection({ data: AnalyticsData; isAdmin: boolean })`, a named export rendered by Task 6's `Analytics.tsx`.

- [ ] **Step 1: Write the component**

Create `src/components/analytics/PipelineSection.tsx`:

```tsx
import { formatCurrency, stageInfo } from '../../lib/utils';
import type { AnalyticsData } from '../../hooks/useAnalytics';
import { Card } from '../ui/Card';
import { BarChart } from './BarChart';
import { DonutChart } from './DonutChart';

/** Pipeline health: leads by stage/vertical/contractor, conversion funnel, won deals. */
export function PipelineSection({ data, isAdmin }: { data: AnalyticsData; isAdmin: boolean }) {
  const stageData = data.leadsByStage.map((s) => ({ label: stageInfo(s.stage).label, value: s.count }));
  const verticalData = data.leadsByVertical.map((v) => ({ label: v.vertical, value: v.count }));
  const funnelData = data.funnel.map((f) => ({ label: stageInfo(f.stage).label, value: f.count }));
  const contractorData = data.leadsByContractor?.map((c) => ({ label: c.contractorName, value: c.count })) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold">Pipeline</h2>
        {!isAdmin && <span className="text-xs text-muted">Showing your own activity. Admins see the whole org.</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Leads by stage</h3>
          <BarChart data={stageData} color="#00DFDF" />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Leads by vertical</h3>
          <DonutChart data={verticalData} />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Conversion funnel</h3>
          <BarChart data={funnelData} color="#8B32FF" />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {data.funnel.map((f) => (
              <span key={f.stage}>
                {stageInfo(f.stage).label}
                {f.conversionFromPrevious !== null && ` — ${Math.round(f.conversionFromPrevious * 100)}%`}
              </span>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Won deals</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">{data.wonDeals.count}</span>
            <span className="text-sm text-muted">deals — {formatCurrency(data.wonDeals.totalValue)}</span>
          </div>
        </Card>

        {isAdmin && data.leadsByContractor && (
          <Card className="md:col-span-2">
            <h3 className="mb-2 text-sm font-semibold text-muted">Leads by contractor</h3>
            <BarChart data={contractorData} color="#F0386B" />
          </Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/PipelineSection.tsx
git commit -m "feat: add PipelineSection analytics component"
```

---

### Task 5: `OutreachSection` component

**Files:**
- Create: `src/components/analytics/OutreachSection.tsx`

**Interfaces:**
- Consumes: `AnalyticsData` type from `../../hooks/useAnalytics`; `DonutChart` from `./DonutChart`; `Card` from `../ui/Card`.
- Produces: `OutreachSection({ data: AnalyticsData; isAdmin: boolean })`, a named export rendered by Task 6's `Analytics.tsx`.

- [ ] **Step 1: Write the component**

Create `src/components/analytics/OutreachSection.tsx`:

```tsx
import type { AnalyticsData } from '../../hooks/useAnalytics';
import { Card } from '../ui/Card';
import { DonutChart } from './DonutChart';

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Outreach performance: email/reply rate, sequence status, LinkedIn sends, scraper yield, autopilot spend. */
export function OutreachSection({ data, isAdmin }: { data: AnalyticsData; isAdmin: boolean }) {
  const sequenceData = data.sequenceStatusBreakdown.map((s) => ({ label: statusLabel(s.status), value: s.count }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[20px] font-bold">Outreach</h2>
        {!isAdmin && (
          <span className="text-xs text-muted">
            Email, sequence, and scraper numbers reflect your own activity. LinkedIn and autopilot numbers are org-wide.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Emails</h3>
          <div className="flex items-center justify-around py-6 text-center">
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.emailStats.sent}</p>
              <p className="text-xs text-muted">sent</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.emailStats.replies}</p>
              <p className="text-xs text-muted">replies</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{Math.round(data.emailStats.replyRate * 100)}%</p>
              <p className="text-xs text-muted">reply rate</p>
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Sequence enrollments</h3>
          <DonutChart data={sequenceData} />
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">LinkedIn</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">{data.linkedinSent}</span>
            <span className="text-sm text-muted">DMs sent</span>
          </div>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-muted">Scraper yield</h3>
          <div className="flex items-center justify-around py-6 text-center">
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.scraperYield.found}</p>
              <p className="text-xs text-muted">found</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-cyan">{data.scraperYield.approved}</p>
              <p className="text-xs text-muted">approved</p>
            </div>
          </div>
        </Card>

        <Card className="md:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-muted">Autopilot spend</h3>
          <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
            <span className="text-4xl font-extrabold text-cyan">${(data.autopilotSpendCents / 100).toFixed(2)}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/OutreachSection.tsx
git commit -m "feat: add OutreachSection analytics component"
```

---

### Task 6: `Analytics.tsx` page — period toggle, loading/error/empty states, route wiring

**Files:**
- Create: `src/pages/Analytics.tsx`
- Modify: `src/App.tsx:56` (replace the `ComingSoon` route with `Analytics`)

**Interfaces:**
- Consumes: `useAnalytics`, `AnalyticsPeriod` from `../hooks/useAnalytics` / `../lib/analytics` (Task 3); `PipelineSection` (Task 4), `OutreachSection` (Task 5); `useOrg` for `currentOrg.role`; `Skeleton`, `EmptyState` from `../components/ui/*`.
- Produces: `Analytics()` page component, wired to the existing `/analytics` route.

- [ ] **Step 1: Write the page**

Create `src/pages/Analytics.tsx`:

```tsx
import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useAnalytics } from '../hooks/useAnalytics';
import type { AnalyticsPeriod } from '../lib/analytics';
import { useOrg } from '../hooks/useOrg';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { PipelineSection } from '../components/analytics/PipelineSection';
import { OutreachSection } from '../components/analytics/OutreachSection';

const PERIOD_LABELS: Record<AnalyticsPeriod, string> = {
  this_month: 'This month',
  last_30_days: 'Last 30 days',
  all_time: 'All time',
};

/** /analytics — pipeline + outreach performance, org-scoped, role-honest (docs/superpowers/specs/2026-09-08-analytics-design.md). */
export function Analytics() {
  const { currentOrg } = useOrg();
  const [period, setPeriod] = useState<AnalyticsPeriod>('this_month');
  const { data, loading, error } = useAnalytics(period);
  const isAdmin = currentOrg?.role === 'admin';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Analytics</h1>
        <div className="flex items-center gap-1 rounded-lg border border-line p-1">
          {(Object.keys(PERIOD_LABELS) as AnalyticsPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              className={`min-h-9 cursor-pointer rounded-md px-3 text-sm font-semibold ${period === p ? 'bg-violet text-offwhite' : 'text-muted hover:text-offwhite'}`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {!loading && error && (
        <Card>
          <p role="alert" className="text-sm text-red-400">Could not load analytics — {error}</p>
        </Card>
      )}

      {!loading && !error && data && (
        <>
          {data.leadsByStage.every((s) => s.count === 0) ? (
            <EmptyState icon={BarChart3} title="No leads yet" hint="Pipeline analytics will appear here once you have leads." />
          ) : (
            <PipelineSection data={data} isAdmin={isAdmin} />
          )}

          {data.emailStats.sent === 0 && data.linkedinSent === 0 && data.scraperYield.found === 0 ? (
            <EmptyState icon={BarChart3} title="No outreach activity yet" hint="Outreach analytics will appear here once you've sent emails, LinkedIn messages, or run a scrape." />
          ) : (
            <OutreachSection data={data} isAdmin={isAdmin} />
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the route**

In `src/App.tsx`, add the import alongside the other page imports (near the `PowerDialer` import added by the previous plan):

```typescript
import { Analytics } from './pages/Analytics';
```

Replace the existing `/analytics` route (`src/App.tsx:56`):

```tsx
              <Route path="/analytics" element={<ComingSoon module="Analytics" />} />
```

with:

```tsx
              <Route path="/analytics" element={<Analytics />} />
```

`ComingSoon` stays imported — it's still used by the catch-all `*` route.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (the pre-existing suite plus Task 2's new `analytics.test.ts`).

- [ ] **Step 5: Manual browser verification**

Start the dev server (`npm run dev`), sign in, navigate to `/analytics`. Confirm:
- The period toggle switches between This month / Last 30 days / All time, and the numbers change accordingly (most visibly "Won deals", "Emails", "Scraper yield" — the snapshot charts like "Leads by stage" should NOT change when the period changes, since those are snapshots per the spec).
- Both sections render with real org data, no console errors.
- As a non-admin: "Leads by contractor" does not render at all; both section captions ("Showing your own activity...") are visible.
- As an admin: "Leads by contractor" renders; no caption text shown.
- A hand-computed spot check: pick one metric (e.g. "Leads by stage" totals should sum to the org's total lead count, checkable against the Pipeline page's own lead count) and confirm it matches.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Analytics.tsx src/App.tsx
git commit -m "feat: wire up /analytics page with period toggle and role-honest sections"
```

---

## Self-Review Notes (from writing this plan)

- **Spec coverage:** every metric in the spec's Data Model table has a `compute*` function (Task 2), is fetched by `useAnalytics` (Task 3), and is rendered by `PipelineSection`/`OutreachSection` (Tasks 4-5). The period toggle, role captions, and admin-only contractor gating are all in Task 6/4. The `email_logs.org_id` and `sequence_enrollments` join-vs-direct-column distinction (found during file-structure research, not originally in the spec's Architecture section) is called out explicitly in Task 3's implementation note so the implementer isn't surprised by it.
- **Placeholder scan:** no TBD/TODO; every step has complete, runnable code.
- **Type consistency:** `AnalyticsPeriod`, `AnalyticsData`, and every `compute*` function's name/signature are identical between where Task 2 defines them, Task 3 imports and calls them, and Tasks 4-5 consume the resulting `AnalyticsData` shape — cross-checked field by field (`leadsByStage`, `funnel`, `wonDeals`, `leadsByVertical`, `leadsByContractor`, `emailStats`, `sequenceStatusBreakdown`, `linkedinSent`, `scraperYield`, `autopilotSpendCents` all match across all three tasks).
