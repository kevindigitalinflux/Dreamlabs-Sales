# Analytics Dashboard — Design Spec

## Context

`/analytics` currently renders the generic `ComingSoon` placeholder. `SPEC.md` §9 sketched an analytics
page back in cycle 1/2 planning — leads-by-stage, a conversion funnel, won-deal value, leads-by-vertical,
leads-by-contractor — written before multi-tenancy (cycle 3), the lead scraper (cycle 4), or outreach
automation (cycle 5, cold email/LinkedIn/autopilot) existed. This spec updates that design for the app as
it actually is today, and extends it to cover outreach performance, not just pipeline state. No chart
library is installed yet — this is the first charted view anywhere in the app; every other numeric summary
(`StatsBar` on the Dashboard) is plain stat cards.

## Decisions Locked (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | **Pipeline + outreach performance.** Not scraper/dialer ops (scraper yield is folded into the outreach section as one stat, not a whole section; dialer/call metrics are out of scope until the Power Dialer has real provider-driven call data — see Out of Scope). |
| Visibility | **Org-scoped, role-gated.** Every user sees only their own org's data (never cross-org, matching every other page in the app). Within an org: contractors see only their own leads/sends; admins see the whole org, plus a per-contractor breakdown contractors don't get. |
| Page structure | **Single `/analytics` page, two stacked sections** (Pipeline, then Outreach) — matches how `EmailsHub` already combines several sub-areas on one page. No sub-routes/tabs; revisit only if a section actually grows too large to scan. |
| Time range | **Three fixed presets: This month / Last 30 days / All time.** No custom date-range picker. Applies only to period-bound *events* (see Data Model below) — snapshot breakdowns (leads by stage/vertical/contractor, the conversion funnel) always reflect all current leads regardless of the selected period, since splitting a funnel by period at this app's lead volumes (single digits to low hundreds per org) would produce statistically meaningless slices. |
| Charting library | **`recharts`** (bar + donut only, per the original spec's own constraint — no line/time-series charts, since nothing here is a real time series yet). First chart usage in the app; add as a normal dependency. |
| Data fetching | **Client-side aggregation**, mirroring `useLeads`'/`leadFilters.ts`'s existing pattern exactly: fetch the relevant rows for the org (+ period, where applicable) via `supabase-js`, compute everything in plain TypeScript. No new database views, RPCs, or migrations — every source table already has org-scoped RLS that plain `.from().select()` calls already respect. |

---

## 1. Data Model (no schema changes)

Every metric below reads from existing tables. No migration in this plan.

| Metric | Source table(s) | Period-bound? |
|---|---|---|
| Leads by stage | `leads` | No (snapshot) |
| Conversion funnel | `leads` + `lead_notes` (parsed) | No (snapshot) |
| Won deals: count + value | `leads` | **Yes** (`stage = 'won'`, transition event) |
| Leads by vertical | `leads` | No (snapshot) |
| Leads by contractor (admin only) | `leads` | No (snapshot) |
| Emails sent + reply rate | `email_logs`, `email_replies` | **Yes** |
| Sequence enrollment status breakdown | `sequence_enrollments` | No (snapshot) |
| LinkedIn DMs sent | `linkedin_drafts` | **Yes** |
| Scraper yield (found vs. approved) | `scrape_jobs` | **Yes** |
| Autopilot spend | `autopilot_runs` | **Yes** |

### Conversion funnel — exact definition

Stage transitions are already logged as `lead_notes` rows with `note_type = 'general'` and
`content = "Stage changed: {fromLabel} → {toLabel}"` (see `src/lib/leadUpdates.ts:24`, already parsed by
`ActivityHistory` in `LeadDetailSections.tsx`). A lead counts as having **reached** stage `S` if either its
current `stage === S`, or any of its stage-change notes has a `toLabel` matching `S`'s label. This correctly
counts leads that later moved past `S` (e.g. reached `proposal_sent` then moved to `won`) *and* leads that
regressed after reaching `S` (e.g. reached `proposal_sent` then got moved to `lost`) — both still "reached"
`proposal_sent`. It deliberately does not use `STAGES`' array order as a rank, since `lost`/`not_now_nurture`
are off-ramps, not "further along" than `won`. Known edge case, not worth engineering around: a lead could
theoretically reach `proposal_sent` (current stage, or a note into it) without ever having a note for
`contacted`/`audit_booked` — every UI path that changes stage (kanban drag, the stage dropdown) always logs
the note, so this only happens via a direct database write bypassing the app, which doesn't occur in normal
use.

Funnel stages, in order: `contacted → audit_booked → proposal_sent → won`. Each stage's bar shows the count
of leads that reached it; the label under each bar shows the conversion rate from the previous stage
(`reached(stage) / reached(previousStage)`, or the raw count for the first stage).

### "Won deals" period scoping

A lead's `stage` is a live field with no historical `won_at` timestamp — only the `lead_notes` transition
event records *when* it became `won`. So "won this period" = leads with `stage = 'won'` **and** a stage-change
note whose `toLabel` is `'Won'` and whose `created_at` falls inside the selected period. (A lead currently
`won` whose transition happened before the period started is excluded — this matches "won this month"
meaning "became won this month", not "is currently won".)

### Period boundaries

- **This month:** from the 1st of the current calendar month, 00:00 local, to now.
- **Last 30 days:** `now - 30 days` to now.
- **All time:** no lower bound.

### Remaining period-bound metrics — exact definitions

- **Emails sent + reply rate:** `sent` = count of `email_logs` rows with `status = 'sent'` and `sent_at`
  inside the period. `replies` = count of `email_replies` rows with `received_at` inside the period. This is
  an activity ratio for the period ("we sent N, we received M replies"), not a strict per-email cohort
  attribution — a reply counted in period X may correspond to an email sent in period X-1. At this app's
  data volumes a true cohort rate would be noisier, not more useful; this definition is what a user
  intuitively means by "how did outreach do this month".
- **LinkedIn DMs sent:** count of `linkedin_drafts` with `status = 'sent'` and `sent_at` inside the period.
- **Scraper yield:** sum `scrape_jobs.results_count` and `scrape_jobs.approved_count` across jobs whose
  `created_at` falls inside the period (i.e. jobs *triggered* during the period — matches "leads I scraped
  this month", not "leads approved this month" from an older job).
- **Autopilot spend:** sum `autopilot_runs.actual_ai_cost_cents` across runs whose `started_at` falls inside
  the period, including runs still active past the period's end (their spend-so-far still counts toward the
  period they started in, not split across periods).

---

## 2. Architecture

```
src/lib/analytics.ts          — pure aggregation functions, unit-testable, no I/O
src/hooks/useAnalytics.ts     — fetches org-scoped rows for the selected period, calls the pure
                                 functions, returns { data, loading, error }
src/pages/Analytics.tsx       — page shell: period selector, role check, renders both sections
src/components/analytics/
  PipelineSection.tsx         — leads-by-stage bar, funnel bar, won-deals stat, vertical donut,
                                 contractor bar (admin only)
  OutreachSection.tsx         — email stat, sequence-status donut, LinkedIn stat, scraper-yield
                                 stat, autopilot-spend stat
  BarChart.tsx, DonutChart.tsx — small recharts wrappers matching this app's card/color conventions
                                 (so individual metric components stay declarative, not
                                 recharts-boilerplate-heavy)
```

`useAnalytics(period)` signature:

```typescript
export type AnalyticsPeriod = 'this_month' | 'last_30_days' | 'all_time';

export interface AnalyticsData {
  leadsByStage: { stage: Stage; count: number }[];
  funnel: { stage: Stage; count: number; conversionFromPrevious: number | null }[];
  wonDeals: { count: number; totalValue: number };
  leadsByVertical: { vertical: string; count: number }[]; // leads with vertical: null group under "Unspecified"
  leadsByContractor: { contractorId: string; contractorName: string; count: number }[] | null; // null for non-admins; unassigned leads group under a synthetic "Unassigned" bucket (contractorId: 'unassigned')
  emailStats: { sent: number; replies: number; replyRate: number };
  sequenceStatusBreakdown: { status: EnrollmentStatus; count: number }[];
  linkedinSent: number;
  scraperYield: { found: number; approved: number };
  autopilotSpendCents: number;
}

export function useAnalytics(period: AnalyticsPeriod): { data: AnalyticsData | null; loading: boolean; error: string | null };
```

The hook fetches per-org (via `useOrg().currentOrg`), and for `leadsByContractor` additionally checks
`currentOrg.role === 'admin'` before querying/returning anything (contractors never even receive other
contractors' `assigned_to` breakdown — not just UI-hidden, actually not fetched separately beyond what the
existing `leads` RLS already returns them).

`src/lib/analytics.ts` exports one pure function per metric (e.g. `computeLeadsByStage(leads)`,
`computeFunnel(leads, notesByLead)`, `computeWonDeals(leads, notesByLead, period)`,
`computeEmailStats(logs, replies)`, `computeSequenceStatusBreakdown(enrollments)`,
`computeScraperYield(jobs)`, `computeAutopilotSpend(runs)`) — each takes already-fetched rows and a period
where relevant, returns plain data, no Supabase calls inside. This is what makes them unit-testable the same
way `leadFilters.ts`'s functions already are.

## 3. Visibility / Role Gating

Matches the existing `FilterBar`'s admin-only "Assigned to" multi-select convention
(`currentOrg?.role === 'admin'`) exactly:

- Pipeline section: every metric except "Leads by contractor" renders for any org member. "Leads by
  contractor" only renders (and is only fetched/computed) for admins.
- Outreach section: fully visible to any org member — outreach metrics are already org-level facts (total
  emails sent by the org, total autopilot spend), not per-contractor, so there's no natural per-contractor
  narrowing to apply here the way the pipeline section's lead ownership provides one.

No RLS changes needed — every underlying query already returns only the calling user's own org's rows
(and, for `leads` specifically, RLS already returns every lead in the org regardless of `assigned_to`,
since `leads_org_admin`/`leads_own_in_org` grant org-wide read to any member — the contractor-vs-admin
distinction here is a *product* choice about what this page chooses to display, not an RLS boundary).

## 4. UI

- Page header: "Analytics" + a 3-way segmented period toggle (This month / Last 30 days / All time),
  matching the button-toggle visual style already used for "Overdue only" in `FilterBar.tsx`.
- Two `Card`-wrapped sections, each with a bold section heading ("Pipeline", "Outreach").
- Charts render inside `Card`s, sized to the existing `max-w` / `Card` padding conventions used elsewhere.
- Loading state: `Skeleton` blocks per section (matching every other page's loading convention).
- Error state: an inline `role="alert"` message inside a `Card`, matching `EmailConfig`'s pattern.
- Empty state: if an org has zero leads (a brand-new org), the Pipeline section shows one `EmptyState`
  ("No leads yet") instead of five empty charts; the Outreach section shows its own `EmptyState`
  independently if there's been no outreach activity yet, since a new org could have leads but no sends.

## Testing

- Unit tests for every function in `src/lib/analytics.ts` (mirrors the existing `leadFilters.test.ts`
  pattern) — in particular the funnel's "reached" logic (a lead that regressed after reaching a stage still
  counts; a lead with no stage-change notes at all, e.g. one still sitting at `new_lead`, correctly reaches
  nothing in the funnel) and the period-boundary math for all three presets.
- Manual verification: real org data (already exists — DI Dreamlabs' leads/notes/email_logs), checked
  against a hand-computed expectation for at least one metric per section.

## Out of Scope

- Call/dialer metrics — the `calls` table (added by the just-shipped Power Dialer Phase 1) is empty until a
  provider is wired up; nothing to chart yet. Revisit once real call data exists.
- Any new database view, RPC, or migration — current data volumes don't need server-side aggregation.
- A custom date-range picker — three fixed presets are enough for now; upgrade later if requested.
- Time-series/trend line charts — no metric here is tracked as a real day-by-day series yet (would need a
  new snapshot/rollup table); the three period presets answer "how are we doing over roughly this window",
  not "show me the trend line".
- Exporting analytics data (CSV/PDF) — not requested, no existing export pattern for this kind of page to
  mirror (the review-table CSV export is a different, row-level export, not a summary export).
