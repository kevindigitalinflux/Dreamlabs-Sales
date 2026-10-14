# Jobs Tracker and Notification Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Jobs page and a top-of-screen notification bar that name every background job by its leads, show what is running, what needs the user and what finished, and let finished jobs be deleted or cleared.

**Architecture:** Pure, unit-tested job logic in `src/lib/jobs/` (model, view helpers, "seen" storage). One small adapter per existing run type (Deep find, selected-leads outreach, scraper, scheduled campaign) loads rows and maps them to a common `JobItem`; a single `JobsProvider` mounted in `AppShell` keeps them live and feeds the Jobs page, the notification bar, the sidebar count and the tab title. Database change is one migration giving Deep find runs a delete right (the other kinds already have one).

**Tech Stack:** React 19, TypeScript strict, Tailwind v4, react-router 8, Supabase (postgres_changes realtime, RLS), vitest (node environment, `.ts` tests only, no DOM tests).

**Spec:** `docs/superpowers/specs/2026-10-14-jobs-tracker-design.md` (read it first).

## Global Constraints

- Job kinds: `deep_find`, `selected_outreach`, `scrape`, `campaign`. States: `needs_you`, `running`, `done`, `failed`, `stopped`. **Needs-you beats running.**
- Titles name the leads: first two business names, sorted alphabetically (ruling below), then `+N`; scraper titles are the saved search wording shortened to 60 characters; the scheduled campaign is "Autopilot campaign" and is read-only (`canStop = canDelete = false`, `href = '/outreach/autopilot'`).
- Finished items whose `finishedAt` is **more than 14 days** before now go in the "Older" group (collapsed, never auto-deleted).
- Only **finished, failed or stopped** jobs can be deleted; **running jobs are never deletable**; "Clear finished" never includes needs-you or running jobs. Deleting a job never deletes leads, contacts already added, sent emails or email logs.
- Delete rights: the creator or an organisation admin (database enforces; UI offers Delete only when `canDelete`).
- Notification bar: needs-you lines (violet, persist until resolved, not dismissible), running lines, then unseen finished lines (green, dismissible, only finishes within the last 24 hours), at most **three lines then "+N more"**; the campaign kind never appears in the bar or the tab title. "Seen" state is per browser (`localStorage`, in try/catch). Tab title is `(N) Dreamlabs Sales` where N = needs-you jobs + unseen recent finished jobs, and plain `Dreamlabs Sales` at zero.
- Accessibility: text states the situation in words (colour only reinforces); badge text uses the normal text colour (`text-offwhite`) with a coloured dot (cyan or green text fails contrast in the light theme); a polite live region announces only newly appearing needs-you and finished lines, never running progress; the bar never takes focus; respect `prefers-reduced-motion`; delete confirmation is an in-page `Modal`, never `window.confirm`.
- Any hook that may be mounted twice uses a per-instance realtime channel name via `useId()` (CLAUDE.md rule). One `JobsProvider` instance only.
- Migration number is **060**. **Subagents must NOT apply migrations or run SQL against the live database** (the permission system blocks it, and Kevin reviews migrations): they only write the files. The controller (or Kevin in the Supabase SQL editor) applies 060 and runs the audit.
- Windows line-ending noise: stage explicit paths only, never `git add .` or `-A`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push (the controller pushes).
- Full suite must stay green after every task: `npx vitest run`, and `npx tsc --noEmit` clean.

**Rulings made while planning (spec deviations, each simpler or forced by the schema):**
1. `deep_find_leads` has no creation timestamp, so lead names are sorted **alphabetically** (case-insensitive), not by when they entered the run.
2. Selected-leads outreach "needs you" uses the existing `countOpenNeedsInput` rule (needs-input rows whose parked draft is still unsent), the same rule the sidebar's Autopilot badge uses, so the two never disagree.
3. `autopilot_runs` has no finish time, so a finished selected run's `finishedAt` is the newest `updated_at` among its lead rows (or its `started_at` when it has none).
4. The scheduled campaign is excluded from the bar and tab title (a multi-day campaign would otherwise sit in the bar for weeks).
5. Realtime delete events on `deep_find_runs` cannot be filtered by organisation (default replica identity), so deletes are applied optimistically in the deleting tab and other tabs catch up on the 30-second refetch.

## Review Focus

- A lead with no readable name, or duplicate names: titles still count correctly (`total` is the number of lead rows, not of names). Owned by Task 1.
- Needs-you and running at the same time (a Deep find with finished leads waiting while others still run): shows as needs-you with progress kept. Owned by Task 1.
- A scrape job `completed` with zero pending results, and one still `running`: done versus running; a `failed` job never shows raw error text. Owned by Task 1.
- Exactly 14 days old, and `finishedAt` missing on a finished job: grouping must not crash and must not hide it. Owned by Task 2.
- A corrupt, missing or throwing `localStorage`: the bar must still work (everything counts as unseen). Owned by Task 2.
- One source failing to load must not blank the others, and must not drop rows already shown for that source. Owned by Task 4 (reviewed in the live check).
- Delete refused by the database (other user's job) must show a plain message, not silently remove the row. Owned by Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/jobs/model.ts` (create) | Types, naming, the four mappers (pure) |
| `src/lib/jobs/model.test.ts` (create) | Tests for the model |
| `src/lib/jobs/view.ts` (create) | Grouping, notification lines, tab title, summary, time-ago (pure) |
| `src/lib/jobs/view.test.ts` (create) | Tests for the view helpers |
| `src/lib/jobs/seen.ts` (create) | Per-browser "seen" storage helpers (pure with an injected storage) |
| `src/lib/jobs/seen.test.ts` (create) | Tests for seen storage |
| `supabase/migrations/060_deep_find_run_delete.sql` (create) | Delete right for Deep find runs |
| `supabase/audits/jobs_delete_rls.sql` (create) | Rolled-back security audit for deletes |
| `src/lib/jobs/sources.ts` (create) | The four adapters + registry (Supabase reads) |
| `src/hooks/useJobs.tsx` (create) | `JobsProvider` + `useJobs()` (live data, actions, seen, tab title) |
| `src/components/jobs/JobRow.tsx` (create) | One job row with actions |
| `src/components/jobs/ConfirmDialog.tsx` (create) | Reusable in-page confirmation (wraps `Modal`) |
| `src/pages/Jobs.tsx` (create) | The Jobs page |
| `src/App.tsx` (modify) | `/jobs` route, redirect `/pipeline/deep-find` |
| `src/pages/DeepFindRuns.tsx` (delete) | Replaced by the Jobs page |
| `src/components/deepfind/DeepFindRunsLink.tsx` (modify) | Link to `/jobs` |
| `src/components/layout/Sidebar.tsx` (modify) | Jobs item with needs-you count |
| `src/components/jobs/JobsBar.tsx` (create) | The notification bar |
| `src/components/layout/AppShell.tsx` (modify) | Mount the provider and the bar |
| `CLAUDE.md`, `docs/AUTOMATIONS.md` (modify) | Record what shipped |

---

### Task 1: Job model (pure)

**Files:**
- Create: `src/lib/jobs/model.ts`
- Test: `src/lib/jobs/model.test.ts`

**Interfaces:**
- Consumes: `needsAttention` from `../deepFindView` (signature `needsAttention(row: Pick<DeepFindActivityRow, 'status' | 'domains' | 'lead'>): boolean`), `countOpenNeedsInput` from `../runLeadGroups` (signature `countOpenNeedsInput(rows: { status: string; email_log_id: string | null }[], logStatuses: ReadonlyMap<string, string>): number`).
- Produces (used by every later task):
  - `type JobKind = 'deep_find' | 'selected_outreach' | 'scrape' | 'campaign'`
  - `type JobState = 'needs_you' | 'running' | 'done' | 'failed' | 'stopped'`
  - `interface JobItem { id: string; kind: JobKind; sourceId: string; title: string; detail: string; state: JobState; progress: { done: number; total: number } | null; needsYou: number; startedAt: string; finishedAt: string | null; href: string; canStop: boolean; canDelete: boolean; deleteWarning: string | null }`
  - `FINISHED_STATES: readonly JobState[]` (`done`, `failed`, `stopped`) and `isFinishedState(state: JobState): boolean`
  - `nameLeads(names: Array<string | null | undefined>, total?: number): string`, `shorten(text: string, max: number): string`
  - `mapDeepFind(run: DeepFindRunInput, leads: DeepFindLeadInput[]): JobItem`
  - `mapSelectedOutreach(run: SelectedRunInput, leads: SelectedLeadInput[], logStatuses: ReadonlyMap<string, string>): JobItem`
  - `mapScrape(job: ScrapeJobInput, pendingCount: number): JobItem`
  - `mapCampaign(run: CampaignRunInput, now: Date): JobItem`
  - input types `DeepFindRunInput`, `DeepFindLeadInput`, `SelectedRunInput`, `SelectedLeadInput`, `ScrapeJobInput`, `CampaignRunInput` (defined in the code below)

- [ ] **Step 1: Write the failing test**

Create `src/lib/jobs/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  isFinishedState, mapCampaign, mapDeepFind, mapScrape, mapSelectedOutreach, nameLeads, shorten,
  type CampaignRunInput, type DeepFindLeadInput, type DeepFindRunInput, type ScrapeJobInput, type SelectedLeadInput, type SelectedRunInput,
} from './model';

describe('nameLeads', () => {
  it('names zero, one, two and many leads', () => {
    expect(nameLeads([])).toBe('No leads yet');
    expect(nameLeads(['Love Living'])).toBe('Love Living');
    expect(nameLeads(['Love Living', 'FMJ Property'])).toBe('FMJ Property, Love Living');
    expect(nameLeads(['d', 'b', 'a', 'c', 'e'])).toBe('a, b +3');
  });
  it('trims, sorts without regard to case and skips empty or missing names', () => {
    expect(nameLeads(['  zeta ', 'Alpha', null, undefined, '', '   '])).toBe('Alpha, zeta');
  });
  it('counts leads by total, not by readable names (a lead the viewer cannot name still counts)', () => {
    expect(nameLeads([], 3)).toBe('3 leads');
    expect(nameLeads([], 1)).toBe('1 lead');
    expect(nameLeads(['Love Living'], 4)).toBe('Love Living +3');
    expect(nameLeads(['A', 'B', 'C'])).toBe('A, B +1');
  });
  it('keeps duplicate names (two real leads share a name)', () => {
    expect(nameLeads(['Acme', 'Acme', 'Acme'])).toBe('Acme, Acme +1');
  });
});

describe('shorten', () => {
  it('collapses whitespace and cuts long text with an ellipsis', () => {
    expect(shorten('cleaning   firms\n in Hackney', 60)).toBe('cleaning firms in Hackney');
    expect(shorten('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
    expect(shorten('x'.repeat(10), 10)).toBe('xxxxxxxxxx');
  });
});

describe('isFinishedState', () => {
  it('is true only for done, failed and stopped', () => {
    expect(['needs_you', 'running', 'done', 'failed', 'stopped'].map((s) => isFinishedState(s as never))).toEqual([false, false, true, true, true]);
  });
});

const dfRun = (over: Partial<DeepFindRunInput> = {}): DeepFindRunInput => ({
  id: 'run-1', status: 'active', lead_count: 3, started_at: '2026-10-14T10:00:00Z', finished_at: null, ...over,
});
const dfLead = (over: Partial<DeepFindLeadInput> = {}): DeepFindLeadInput => ({
  status: 'done', people_found: 0, domains: {}, business_name: 'Alpha', company_number: null, ...over,
});

describe('mapDeepFind', () => {
  it('shows a running run with progress and names the leads', () => {
    const job = mapDeepFind(dfRun(), [dfLead({ business_name: 'Love Living' }), dfLead({ business_name: 'FMJ Property', status: 'running' }), dfLead({ business_name: 'Third', status: 'queued' })]);
    expect(job).toMatchObject({
      id: 'deep_find:run-1', kind: 'deep_find', sourceId: 'run-1', title: 'FMJ Property, Love Living +1', state: 'running',
      detail: '1 of 3 leads done', progress: { done: 1, total: 3 }, needsYou: 0, canStop: true, canDelete: false,
      href: '/pipeline/deep-find/run-1', finishedAt: null,
    });
  });
  it('needs-you beats running and keeps the progress', () => {
    const waiting = dfLead({ business_name: 'Love Living', domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    const job = mapDeepFind(dfRun(), [waiting, dfLead({ status: 'running' })]);
    expect(job.state).toBe('needs_you');
    expect(job.needsYou).toBe(1);
    expect(job.detail).toBe('1 lead needs you (choose a company or check people)');
    expect(job.progress).toEqual({ done: 1, total: 3 });
    expect(job.canStop).toBe(true);
    expect(job.canDelete).toBe(false);
  });
  it('a running lead with the same data does not count as needing the user', () => {
    const waiting = dfLead({ status: 'running', domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    expect(mapDeepFind(dfRun(), [waiting]).state).toBe('running');
  });
  it('shows a completed run as done with its people count and allows delete', () => {
    const job = mapDeepFind(dfRun({ status: 'completed', finished_at: '2026-10-14T11:00:00Z', lead_count: 2 }), [dfLead({ people_found: 2 }), dfLead({ people_found: 1, business_name: 'B' })]);
    expect(job).toMatchObject({ state: 'done', detail: '2 leads, 3 people added', finishedAt: '2026-10-14T11:00:00Z', canStop: false, canDelete: true });
    expect(job.deleteWarning).toBe('People already added to leads stay.');
  });
  it('uses singular words for one lead and one person', () => {
    const job = mapDeepFind(dfRun({ status: 'completed', lead_count: 1, finished_at: 'x' }), [dfLead({ people_found: 1 })]);
    expect(job.detail).toBe('1 lead, 1 person added');
  });
  it('shows a cancelled run as stopped and a finished run that still needs the user as needs-you but deletable with a warning', () => {
    expect(mapDeepFind(dfRun({ status: 'cancelled', finished_at: 'x' }), [dfLead(), dfLead({ status: 'queued' })])).toMatchObject({ state: 'stopped', detail: 'Stopped after 1 of 3 leads' });
    const waiting = dfLead({ domains: { named_by_web: [{ name: 'Jonathan Love', role: 'Partner' }] } });
    const job = mapDeepFind(dfRun({ status: 'completed', finished_at: 'x', lead_count: 1 }), [waiting]);
    expect(job).toMatchObject({ state: 'needs_you', canDelete: true });
    expect(job.deleteWarning).toBe('This job still needs you: deleting it discards those choices. People already added to leads stay.');
  });
  it('counts total from lead_count when rows are fewer (rows the viewer cannot see) and from rows when more', () => {
    expect(mapDeepFind(dfRun({ lead_count: 5 }), [dfLead()]).progress).toEqual({ done: 1, total: 5 });
    expect(mapDeepFind(dfRun({ lead_count: 1 }), [dfLead(), dfLead()]).progress).toEqual({ done: 2, total: 2 });
  });
  it('copes with a run that has no lead rows at all', () => {
    expect(mapDeepFind(dfRun({ lead_count: 2 }), [])).toMatchObject({ title: '2 leads', state: 'running', detail: '0 of 2 leads done' });
  });
});

const selRun = (over: Partial<SelectedRunInput> = {}): SelectedRunInput => ({ id: 'sel-1', status: 'active', started_at: '2026-10-14T09:00:00Z', ...over });
const selLead = (over: Partial<SelectedLeadInput> = {}): SelectedLeadInput => ({
  status: 'sent', email_log_id: null, business_name: 'Alpha', updated_at: '2026-10-14T09:30:00Z', ...over,
});

describe('mapSelectedOutreach', () => {
  it('shows a running run with progress', () => {
    const job = mapSelectedOutreach(selRun(), [selLead(), selLead({ status: 'queued', business_name: 'B' }), selLead({ status: 'working', business_name: 'C' })], new Map());
    expect(job).toMatchObject({
      id: 'selected_outreach:sel-1', state: 'running', detail: '1 of 3 leads handled', progress: { done: 1, total: 3 },
      href: '/outreach/autopilot', canStop: true, canDelete: false, title: 'Alpha, B +1',
    });
  });
  it('counts only needs-input rows whose draft is still unsent as needing the user', () => {
    const rows = [selLead({ status: 'needs_input', email_log_id: 'log-open', business_name: 'A' }), selLead({ status: 'needs_input', email_log_id: 'log-sent', business_name: 'B' })];
    const job = mapSelectedOutreach(selRun(), rows, new Map([['log-open', 'draft'], ['log-sent', 'sent']]));
    expect(job.state).toBe('needs_you');
    expect(job.needsYou).toBe(1);
    expect(job.detail).toBe('1 draft is waiting for you');
    const settled = mapSelectedOutreach(selRun(), rows, new Map([['log-open', 'sent'], ['log-sent', 'sent']]));
    expect(settled.state).toBe('running');
  });
  it('finished run: done with sent count, finishedAt is the newest lead update, delete allowed with a warning', () => {
    const job = mapSelectedOutreach(selRun({ status: 'completed' }), [selLead({ updated_at: '2026-10-14T10:00:00Z' }), selLead({ updated_at: '2026-10-14T12:00:00Z', business_name: 'B' }), selLead({ status: 'skipped', business_name: 'C' })], new Map());
    expect(job).toMatchObject({ state: 'done', detail: '2 of 3 sent', finishedAt: '2026-10-14T12:00:00Z', canDelete: true, canStop: false });
    expect(job.deleteWarning).toBe('Emails already sent and drafts in Emails stay.');
  });
  it('cancelled run is stopped; a finished run with no lead rows falls back to started_at', () => {
    expect(mapSelectedOutreach(selRun({ status: 'cancelled' }), [selLead()], new Map())).toMatchObject({ state: 'stopped', detail: 'Stopped after 1 of 1' });
    expect(mapSelectedOutreach(selRun({ status: 'completed' }), [], new Map()).finishedAt).toBe('2026-10-14T09:00:00Z');
  });
});

const scrapeJob = (over: Partial<ScrapeJobInput> = {}): ScrapeJobInput => ({
  id: 'job-1', status: 'completed', icp_raw_input: 'cleaning firms in Hackney', results_count: 24, approved_count: 10,
  started_at: '2026-10-14T08:00:00Z', completed_at: '2026-10-14T08:05:00Z', created_at: '2026-10-14T07:59:00Z', ...over,
});

describe('mapScrape', () => {
  it('running and pending jobs are running with no stop and no delete', () => {
    for (const status of ['pending', 'running'] as const) {
      expect(mapScrape(scrapeJob({ status, completed_at: null }), 0)).toMatchObject({ state: 'running', detail: 'Searching for leads…', canStop: false, canDelete: false, progress: null });
    }
  });
  it('completed with results waiting is needs-you, with a warning that unreviewed results go with it', () => {
    const job = mapScrape(scrapeJob(), 14);
    expect(job).toMatchObject({ state: 'needs_you', needsYou: 14, detail: '14 results to review', href: '/scraper/jobs/job-1', canDelete: true });
    expect(job.deleteWarning).toBe('Results you have not reviewed go with it. Leads you approved stay in your pipeline.');
    expect(mapScrape(scrapeJob(), 1).detail).toBe('1 result to review');
  });
  it('completed with nothing left to review is done', () => {
    const job = mapScrape(scrapeJob(), 0);
    expect(job).toMatchObject({ state: 'done', detail: '24 results, 10 approved', needsYou: 0, finishedAt: '2026-10-14T08:05:00Z' });
    expect(job.deleteWarning).toBe('Leads you approved stay in your pipeline.');
  });
  it('failed jobs never show raw error text and can be deleted', () => {
    const job = mapScrape(scrapeJob({ status: 'failed', completed_at: null }), 0);
    expect(job).toMatchObject({ state: 'failed', detail: 'The search did not finish', canDelete: true });
    expect(job.finishedAt).toBe('2026-10-14T08:00:00Z');
  });
  it('titles come from the saved search wording, shortened, with a fallback; startedAt falls back to created_at', () => {
    expect(mapScrape(scrapeJob({ icp_raw_input: 'x'.repeat(200) }), 0).title).toHaveLength(60);
    expect(mapScrape(scrapeJob({ icp_raw_input: null }), 0).title).toBe('Lead search');
    expect(mapScrape(scrapeJob({ icp_raw_input: '   ' }), 0).title).toBe('Lead search');
    expect(mapScrape(scrapeJob({ started_at: null }), 0).startedAt).toBe('2026-10-14T07:59:00Z');
  });
});

const campaign = (over: Partial<CampaignRunInput> = {}): CampaignRunInput => ({
  id: 'camp-1', status: 'active', started_at: '2026-10-12T09:00:00Z', ends_at: '2026-10-26T09:00:00Z', duration_days: 14, ...over,
});

describe('mapCampaign', () => {
  it('is read-only, never deletable or stoppable, and links to Autopilot', () => {
    const job = mapCampaign(campaign(), new Date('2026-10-14T12:00:00Z'));
    expect(job).toMatchObject({
      id: 'campaign:camp-1', kind: 'campaign', title: 'Autopilot campaign', state: 'running', detail: 'Day 3 of 14',
      progress: { done: 3, total: 14 }, href: '/outreach/autopilot', canStop: false, canDelete: false, deleteWarning: null,
    });
  });
  it('caps the day at the duration and maps finished states', () => {
    expect(mapCampaign(campaign(), new Date('2026-12-01T00:00:00Z')).detail).toBe('Day 14 of 14');
    expect(mapCampaign(campaign({ status: 'completed' }), new Date()).state).toBe('done');
    expect(mapCampaign(campaign({ status: 'cancelled', ends_at: null }), new Date())).toMatchObject({ state: 'stopped', finishedAt: '2026-10-12T09:00:00Z' });
  });
  it('copes with a missing duration', () => {
    expect(mapCampaign(campaign({ duration_days: null }), new Date('2026-10-14T12:00:00Z'))).toMatchObject({ detail: 'Day 3', progress: null });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/jobs/model.test.ts`
Expected: FAIL (cannot find module `./model`).

- [ ] **Step 3: Write the implementation**

Create `src/lib/jobs/model.ts`:

```ts
// src/lib/jobs/model.ts
// The shared shape of a background job and the pure mappers that turn each existing run type into it.
// Pure on purpose (no React, no Supabase): unit-tested in node. See docs/superpowers/specs/2026-10-14-jobs-tracker-design.md.
import { needsAttention } from '../deepFindView';
import { countOpenNeedsInput } from '../runLeadGroups';

export type JobKind = 'deep_find' | 'selected_outreach' | 'scrape' | 'campaign';
export type JobState = 'needs_you' | 'running' | 'done' | 'failed' | 'stopped';

export interface JobItem {
  id: string;
  kind: JobKind;
  sourceId: string;
  /** Names what the job works on, e.g. "Love Living, FMJ Property +3". */
  title: string;
  /** One plain-words line: progress, what needs the user, or the outcome. */
  detail: string;
  state: JobState;
  progress: { done: number; total: number } | null;
  /** How many items need the user (0 when none). */
  needsYou: number;
  startedAt: string;
  finishedAt: string | null;
  href: string;
  canStop: boolean;
  /** True only for finished, failed or stopped jobs of a kind that may be deleted. */
  canDelete: boolean;
  /** An extra sentence for the delete confirmation, or null. */
  deleteWarning: string | null;
}

export const FINISHED_STATES: readonly JobState[] = ['done', 'failed', 'stopped'];
export const isFinishedState = (state: JobState): boolean => FINISHED_STATES.includes(state);

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Collapses whitespace and cuts to `max` characters with an ellipsis. */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * "Love Living, FMJ Property +3": the first two names (sorted, case-insensitive) then how many more. `total` is the
 * real number of leads (default: the number of readable names) so leads the viewer cannot name still count.
 */
export function nameLeads(names: Array<string | null | undefined>, total?: number): string {
  const clean = names.map((n) => (n ?? '').trim()).filter((n) => n !== '')
    .sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }));
  const count = Math.max(total ?? clean.length, clean.length);
  if (clean.length === 0) return count > 0 ? `${count} ${plural(count, 'lead', 'leads')}` : 'No leads yet';
  const shown = clean.slice(0, 2);
  const rest = count - shown.length;
  return rest > 0 ? `${shown.join(', ')} +${rest}` : shown.join(', ');
}

// ---------- Deep find ----------
export interface DeepFindRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; lead_count: number; started_at: string; finished_at: string | null }
export interface DeepFindLeadInput {
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped';
  people_found: number;
  domains: unknown;
  business_name: string | null;
  company_number: string | null;
}

export function mapDeepFind(run: DeepFindRunInput, leads: DeepFindLeadInput[]): JobItem {
  const needsYou = leads.filter((l) => needsAttention({ status: l.status, domains: l.domains, lead: { company_number: l.company_number } })).length;
  const done = leads.filter((l) => l.status !== 'queued' && l.status !== 'running').length;
  const total = Math.max(run.lead_count, leads.length);
  const people = leads.reduce((sum, l) => sum + (l.people_found || 0), 0);
  const state: JobState = needsYou > 0 ? 'needs_you' : run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const detail = state === 'needs_you'
    ? `${needsYou} ${plural(needsYou, 'lead needs', 'leads need')} you (choose a company or check people)`
    : state === 'running' ? `${done} of ${total} leads done`
    : state === 'done' ? `${total} ${plural(total, 'lead', 'leads')}, ${people} ${plural(people, 'person', 'people')} added`
    : `Stopped after ${done} of ${total} leads`;
  return {
    id: `deep_find:${run.id}`, kind: 'deep_find', sourceId: run.id,
    title: nameLeads(leads.map((l) => l.business_name), total),
    detail, state, progress: { done, total }, needsYou,
    startedAt: run.started_at, finishedAt: run.finished_at,
    href: `/pipeline/deep-find/${run.id}`,
    canStop: run.status === 'active', canDelete: run.status !== 'active',
    deleteWarning: state === 'needs_you'
      ? 'This job still needs you: deleting it discards those choices. People already added to leads stay.'
      : 'People already added to leads stay.',
  };
}

// ---------- Selected-leads outreach ----------
export interface SelectedRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; started_at: string }
export interface SelectedLeadInput { status: string; email_log_id: string | null; business_name: string | null; updated_at: string }

export function mapSelectedOutreach(run: SelectedRunInput, leads: SelectedLeadInput[], logStatuses: ReadonlyMap<string, string>): JobItem {
  const needsYou = countOpenNeedsInput(leads.map((l) => ({ status: l.status, email_log_id: l.email_log_id })), logStatuses);
  const total = leads.length;
  const done = leads.filter((l) => l.status !== 'queued' && l.status !== 'working').length;
  const sent = leads.filter((l) => l.status === 'sent').length;
  const state: JobState = needsYou > 0 ? 'needs_you' : run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const detail = state === 'needs_you' ? `${needsYou} ${plural(needsYou, 'draft is', 'drafts are')} waiting for you`
    : state === 'running' ? `${done} of ${total} leads handled`
    : state === 'done' ? `${sent} of ${total} sent`
    : `Stopped after ${done} of ${total}`;
  const newest = leads.reduce<string | null>((max, l) => (max === null || l.updated_at > max ? l.updated_at : max), null);
  return {
    id: `selected_outreach:${run.id}`, kind: 'selected_outreach', sourceId: run.id,
    title: nameLeads(leads.map((l) => l.business_name), total),
    detail, state, progress: { done, total }, needsYou,
    startedAt: run.started_at, finishedAt: run.status === 'active' ? null : (newest ?? run.started_at),
    href: '/outreach/autopilot',
    canStop: run.status === 'active', canDelete: run.status !== 'active',
    deleteWarning: 'Emails already sent and drafts in Emails stay.',
  };
}

// ---------- Scraper ----------
export interface ScrapeJobInput {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  icp_raw_input: string | null;
  results_count: number;
  approved_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function mapScrape(job: ScrapeJobInput, pendingCount: number): JobItem {
  const startedAt = job.started_at ?? job.created_at;
  const state: JobState = job.status === 'failed' ? 'failed'
    : job.status === 'completed' ? (pendingCount > 0 ? 'needs_you' : 'done') : 'running';
  const detail = state === 'running' ? 'Searching for leads…'
    : state === 'needs_you' ? `${pendingCount} ${plural(pendingCount, 'result', 'results')} to review`
    : state === 'done' ? `${job.results_count} ${plural(job.results_count, 'result', 'results')}, ${job.approved_count} approved`
    : 'The search did not finish';
  return {
    id: `scrape:${job.id}`, kind: 'scrape', sourceId: job.id,
    title: shorten(job.icp_raw_input ?? '', 60) || 'Lead search',
    detail, state, progress: null, needsYou: state === 'needs_you' ? pendingCount : 0,
    startedAt, finishedAt: job.status === 'completed' || job.status === 'failed' ? (job.completed_at ?? startedAt) : null,
    href: `/scraper/jobs/${job.id}`,
    canStop: false, canDelete: job.status === 'completed' || job.status === 'failed',
    deleteWarning: pendingCount > 0
      ? 'Results you have not reviewed go with it. Leads you approved stay in your pipeline.'
      : 'Leads you approved stay in your pipeline.',
  };
}

// ---------- Scheduled Autopilot campaign (read-only) ----------
export interface CampaignRunInput { id: string; status: 'active' | 'completed' | 'cancelled'; started_at: string; ends_at: string | null; duration_days: number | null }

export function mapCampaign(run: CampaignRunInput, now: Date): JobItem {
  const state: JobState = run.status === 'active' ? 'running' : run.status === 'completed' ? 'done' : 'stopped';
  const elapsed = Math.floor((now.getTime() - new Date(run.started_at).getTime()) / 86_400_000) + 1;
  const day = Math.max(1, run.duration_days ? Math.min(run.duration_days, elapsed) : elapsed);
  return {
    id: `campaign:${run.id}`, kind: 'campaign', sourceId: run.id,
    title: 'Autopilot campaign',
    detail: run.duration_days ? `Day ${day} of ${run.duration_days}` : `Day ${day}`,
    state, progress: run.duration_days ? { done: day, total: run.duration_days } : null, needsYou: 0,
    startedAt: run.started_at, finishedAt: run.status === 'active' ? null : (run.ends_at ?? run.started_at),
    href: '/outreach/autopilot', canStop: false, canDelete: false, deleteWarning: null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/jobs/model.test.ts`
Expected: PASS. If the needs-you fixtures do not register as needing attention, open `src/lib/deepFindView.test.ts` (test "flags open company choices and people to check") and use the same `domains` shape; do not change the test's intent.

- [ ] **Step 5: Run the whole suite and commit**

Run: `npx vitest run` and `npx tsc --noEmit`
Expected: all green.

```bash
git add src/lib/jobs/model.ts src/lib/jobs/model.test.ts
git commit -m "feat: job model (naming and mappers for deep find, selected outreach, scrape, campaign)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: View helpers and seen storage (pure)

**Files:**
- Create: `src/lib/jobs/view.ts`, `src/lib/jobs/seen.ts`
- Test: `src/lib/jobs/view.test.ts`, `src/lib/jobs/seen.test.ts`

**Interfaces:**
- Consumes: `JobItem`, `JobState`, `isFinishedState` from `./model` (Task 1).
- Produces:
  - `OLDER_DAYS = 14`, `RECENT_FINISH_HOURS = 24`
  - `interface JobGroups { needsYou: JobItem[]; running: JobItem[]; finished: JobItem[]; older: JobItem[] }`, `groupJobs(items: JobItem[], now: Date): JobGroups`
  - `seenKey(job: JobItem): string`
  - `interface NotifyLine { key: string; jobId: string; tone: 'needs_you' | 'running' | 'finished'; text: string; href: string; dismissible: boolean }`
  - `notifyLines(items: JobItem[], seen: ReadonlySet<string>, now: Date, max?: number): { lines: NotifyLine[]; more: number }`
  - `unseenFinished(items: JobItem[], seen: ReadonlySet<string>, now: Date): JobItem[]`
  - `tabTitleCount(items, seen, now): number`, `tabTitle(count: number, base?: string): string`, `summaryLine(items, seen, now): string | null`
  - `timeAgo(iso: string, now: Date): string`
  - `interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }`, `readSeen(storage: StorageLike | null, orgId: string): Set<string>`, `writeSeen(storage: StorageLike | null, orgId: string, seen: ReadonlySet<string>): void`, `SEEN_MAX = 200`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/jobs/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { JobItem } from './model';
import { groupJobs, notifyLines, seenKey, summaryLine, tabTitle, tabTitleCount, timeAgo, unseenFinished } from './view';

const NOW = new Date('2026-10-14T12:00:00Z');
const job = (over: Partial<JobItem> = {}): JobItem => ({
  id: 'deep_find:r1', kind: 'deep_find', sourceId: 'r1', title: 'Love Living, FMJ +3', detail: '2 of 5 leads done', state: 'running',
  progress: { done: 2, total: 5 }, needsYou: 0, startedAt: '2026-10-14T10:00:00Z', finishedAt: null, href: '/pipeline/deep-find/r1',
  canStop: true, canDelete: false, deleteWarning: null, ...over,
});
const finished = (id: string, finishedAt: string | null, over: Partial<JobItem> = {}) =>
  job({ id, sourceId: id, state: 'done', detail: 'done', finishedAt, canStop: false, canDelete: true, ...over });

describe('groupJobs', () => {
  it('splits into needs-you, running, finished and older, newest first', () => {
    const items = [
      job({ id: 'a', state: 'running', startedAt: '2026-10-14T09:00:00Z' }),
      job({ id: 'b', state: 'running', startedAt: '2026-10-14T11:00:00Z' }),
      job({ id: 'c', state: 'needs_you', needsYou: 1 }),
      finished('d', '2026-10-13T10:00:00Z'),
      finished('e', '2026-10-14T08:00:00Z'),
      finished('f', '2026-09-01T10:00:00Z'),
    ];
    const g = groupJobs(items, NOW);
    expect(g.needsYou.map((j) => j.id)).toEqual(['c']);
    expect(g.running.map((j) => j.id)).toEqual(['b', 'a']);
    expect(g.finished.map((j) => j.id)).toEqual(['e', 'd']);
    expect(g.older.map((j) => j.id)).toEqual(['f']);
  });
  it('treats exactly 14 days as still recent and just over as older', () => {
    const edge = finished('edge', '2026-09-30T12:00:00Z');
    const over = finished('over', '2026-09-30T11:59:59Z');
    const g = groupJobs([edge, over], NOW);
    expect(g.finished.map((j) => j.id)).toEqual(['edge']);
    expect(g.older.map((j) => j.id)).toEqual(['over']);
  });
  it('a finished job with no finishedAt is kept in finished (never hidden)', () => {
    expect(groupJobs([finished('x', null)], NOW).finished.map((j) => j.id)).toEqual(['x']);
  });
  it('an old needs-you job is still needs-you', () => {
    const g = groupJobs([job({ id: 'old', state: 'needs_you', needsYou: 2, startedAt: '2026-01-01T00:00:00Z' })], NOW);
    expect(g.needsYou).toHaveLength(1);
    expect(g.older).toHaveLength(0);
  });
  it('handles an empty list', () => {
    expect(groupJobs([], NOW)).toEqual({ needsYou: [], running: [], finished: [], older: [] });
  });
});

describe('seenKey, unseenFinished', () => {
  it('keys by id and finish time, and only recent done or failed jobs count as unseen finished', () => {
    const recent = finished('r', '2026-10-14T11:00:00Z');
    const failed = finished('f', '2026-10-14T10:00:00Z', { state: 'failed' });
    const stopped = finished('s', '2026-10-14T10:30:00Z', { state: 'stopped' });
    const stale = finished('old', '2026-10-13T11:59:59Z');
    const camp = finished('c', '2026-10-14T11:00:00Z', { kind: 'campaign' });
    const noTime = finished('n', null);
    expect(seenKey(recent)).toBe('r@2026-10-14T11:00:00Z');
    expect(seenKey(noTime)).toBe('n@');
    const unseen = unseenFinished([recent, failed, stopped, stale, camp, noTime], new Set(), NOW);
    expect(unseen.map((j) => j.id)).toEqual(['r', 'f']);
    expect(unseenFinished([recent, failed], new Set([seenKey(recent)]), NOW).map((j) => j.id)).toEqual(['f']);
  });
});

describe('notifyLines', () => {
  it('orders needs-you, then running, then unseen finished, and leaves out the campaign', () => {
    const items = [
      finished('fin', '2026-10-14T11:30:00Z', { title: 'Done job', detail: 'x' }),
      job({ id: 'run', title: 'Running job', detail: '1 of 3 leads done' }),
      job({ id: 'need', state: 'needs_you', needsYou: 1, title: 'Waiting job', detail: '1 lead needs you (choose a company or check people)', href: '/pipeline/deep-find/need' }),
      job({ id: 'camp', kind: 'campaign', title: 'Autopilot campaign' }),
    ];
    const { lines, more } = notifyLines(items, new Set(), NOW);
    expect(lines.map((l) => [l.tone, l.jobId])).toEqual([['needs_you', 'need'], ['running', 'run'], ['finished', 'fin']]);
    expect(more).toBe(0);
    expect(lines[0]).toMatchObject({ text: 'Waiting job: 1 lead needs you (choose a company or check people)', href: '/pipeline/deep-find/need', dismissible: false });
    expect(lines[1]).toMatchObject({ text: 'Running job: 1 of 3 leads done', dismissible: false });
    expect(lines[2]).toMatchObject({ text: 'Done job: finished', dismissible: true, key: 'fin@2026-10-14T11:30:00Z' });
  });
  it('caps at three lines and reports how many more', () => {
    const items = [1, 2, 3, 4, 5].map((n) => job({ id: `j${n}`, startedAt: `2026-10-14T0${n}:00:00Z` }));
    const { lines, more } = notifyLines(items, new Set(), NOW);
    expect(lines).toHaveLength(3);
    expect(more).toBe(2);
    expect(notifyLines(items, new Set(), NOW, 2)).toMatchObject({ more: 3 });
  });
  it('failed jobs read as did not finish; seen finished jobs drop out; needs-you never drops', () => {
    const failed = finished('bad', '2026-10-14T11:00:00Z', { state: 'failed', title: 'Search' });
    expect(notifyLines([failed], new Set(), NOW).lines[0].text).toBe('Search: did not finish');
    expect(notifyLines([failed], new Set([seenKey(failed)]), NOW).lines).toEqual([]);
    const need = job({ id: 'n', state: 'needs_you', needsYou: 1 });
    expect(notifyLines([need], new Set(['n@']), NOW).lines).toHaveLength(1);
  });
  it('is empty when there is nothing to say', () => {
    expect(notifyLines([], new Set(), NOW)).toEqual({ lines: [], more: 0 });
  });
});

describe('tab title and phone summary', () => {
  const items = [
    job({ id: 'n1', state: 'needs_you', needsYou: 1 }),
    job({ id: 'r1' }),
    finished('f1', '2026-10-14T11:00:00Z'),
    finished('f2', '2026-10-14T10:00:00Z'),
    job({ id: 'camp', kind: 'campaign' }),
  ];
  it('counts needs-you plus unseen recent finished (not running, not the campaign)', () => {
    expect(tabTitleCount(items, new Set(), NOW)).toBe(3);
    expect(tabTitleCount(items, new Set([seenKey(items[2]), seenKey(items[3])]), NOW)).toBe(1);
    expect(tabTitleCount([], new Set(), NOW)).toBe(0);
  });
  it('builds the title', () => {
    expect(tabTitle(0)).toBe('Dreamlabs Sales');
    expect(tabTitle(3)).toBe('(3) Dreamlabs Sales');
    expect(tabTitle(2, 'Other')).toBe('(2) Other');
  });
  it('summarises for a phone', () => {
    expect(summaryLine(items, new Set(), NOW)).toBe('4 jobs, 1 needs you');
    expect(summaryLine([job({ id: 'only' })], new Set(), NOW)).toBe('1 job');
    expect(summaryLine([job({ id: 'a', state: 'needs_you', needsYou: 2 }), job({ id: 'b', state: 'needs_you', needsYou: 1 })], new Set(), NOW)).toBe('2 jobs, 2 need you');
    expect(summaryLine([], new Set(), NOW)).toBeNull();
  });
});

describe('timeAgo', () => {
  it('reads naturally', () => {
    expect(timeAgo('2026-10-14T11:59:40Z', NOW)).toBe('just now');
    expect(timeAgo('2026-10-14T11:55:00Z', NOW)).toBe('5 minutes ago');
    expect(timeAgo('2026-10-14T11:59:00Z', NOW)).toBe('1 minute ago');
    expect(timeAgo('2026-10-14T10:00:00Z', NOW)).toBe('2 hours ago');
    expect(timeAgo('2026-10-14T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(timeAgo('2026-10-12T12:00:00Z', NOW)).toBe('2 days ago');
    expect(timeAgo('2026-10-13T12:00:00Z', NOW)).toBe('1 day ago');
  });
  it('never shows the future or a bad date as nonsense', () => {
    expect(timeAgo('2026-10-14T12:30:00Z', NOW)).toBe('just now');
    expect(timeAgo('garbage', NOW)).toBe('');
  });
});
```

Create `src/lib/jobs/seen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readSeen, SEEN_MAX, writeSeen, type StorageLike } from './seen';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

describe('seen storage', () => {
  it('round-trips per organisation', () => {
    const s = memory();
    writeSeen(s, 'org-a', new Set(['x@1', 'y@2']));
    expect([...readSeen(s, 'org-a')]).toEqual(['x@1', 'y@2']);
    expect(readSeen(s, 'org-b').size).toBe(0);
  });
  it('treats corrupt, wrong-shaped or missing data as nothing seen', () => {
    const s = memory();
    s.setItem('dreamlabs.jobs.seen.o', '{not json');
    expect(readSeen(s, 'o').size).toBe(0);
    s.setItem('dreamlabs.jobs.seen.o', JSON.stringify({ a: 1 }));
    expect(readSeen(s, 'o').size).toBe(0);
    s.setItem('dreamlabs.jobs.seen.o', JSON.stringify(['ok', 5, null, 'also ok']));
    expect([...readSeen(s, 'o')]).toEqual(['ok', 'also ok']);
    expect(readSeen(memory(), 'o').size).toBe(0);
  });
  it('works without a storage and survives a storage that throws', () => {
    expect(readSeen(null, 'o').size).toBe(0);
    expect(() => writeSeen(null, 'o', new Set(['a']))).not.toThrow();
    const boom: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readSeen(boom, 'o').size).toBe(0);
    expect(() => writeSeen(boom, 'o', new Set(['a']))).not.toThrow();
  });
  it('keeps only the newest entries when there are too many', () => {
    const s = memory();
    const many = new Set(Array.from({ length: SEEN_MAX + 25 }, (_, i) => `k${i}@t`));
    writeSeen(s, 'o', many);
    const back = [...readSeen(s, 'o')];
    expect(back).toHaveLength(SEEN_MAX);
    expect(back[back.length - 1]).toBe(`k${SEEN_MAX + 24}@t`);
    expect(back[0]).toBe('k25@t');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/jobs/view.test.ts src/lib/jobs/seen.test.ts`
Expected: FAIL (cannot find modules `./view`, `./seen`).

- [ ] **Step 3: Write the implementations**

Create `src/lib/jobs/seen.ts`:

```ts
// src/lib/jobs/seen.ts
// Which finished jobs this browser has already shown, per organisation. A per-viewer convenience only: every access is
// wrapped in try/catch and the notification bar works (everything unseen) when storage is missing or blocked.
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SEEN_MAX = 200;
const keyFor = (orgId: string) => `dreamlabs.jobs.seen.${orgId}`;

export function readSeen(storage: StorageLike | null, orgId: string): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(keyFor(orgId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Saves the newest SEEN_MAX entries (insertion order). Never throws. */
export function writeSeen(storage: StorageLike | null, orgId: string, seen: ReadonlySet<string>): void {
  if (!storage) return;
  try {
    storage.setItem(keyFor(orgId), JSON.stringify([...seen].slice(-SEEN_MAX)));
  } catch {
    // storage blocked or full: seen state is a convenience, ignore
  }
}
```

Create `src/lib/jobs/view.ts`:

```ts
// src/lib/jobs/view.ts
// Pure view helpers over JobItem lists: grouping for the Jobs page, the notification bar's lines, the tab title count.
import { isFinishedState, type JobItem } from './model';

export const OLDER_DAYS = 14;
export const RECENT_FINISH_HOURS = 24;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export interface JobGroups { needsYou: JobItem[]; running: JobItem[]; finished: JobItem[]; older: JobItem[] }

const time = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);
const byStartedDesc = (a: JobItem, b: JobItem) => time(b.startedAt) - time(a.startedAt);
const byFinishedDesc = (a: JobItem, b: JobItem) => (time(b.finishedAt) || time(b.startedAt)) - (time(a.finishedAt) || time(a.startedAt));

export function groupJobs(items: JobItem[], now: Date): JobGroups {
  const cutoff = now.getTime() - OLDER_DAYS * DAY_MS;
  const groups: JobGroups = { needsYou: [], running: [], finished: [], older: [] };
  for (const job of items) {
    if (job.state === 'needs_you') groups.needsYou.push(job);
    else if (job.state === 'running') groups.running.push(job);
    else {
      const finishedAt = time(job.finishedAt);
      (Number.isNaN(finishedAt) || finishedAt >= cutoff ? groups.finished : groups.older).push(job);
    }
  }
  groups.needsYou.sort(byStartedDesc);
  groups.running.sort(byStartedDesc);
  groups.finished.sort(byFinishedDesc);
  groups.older.sort(byFinishedDesc);
  return groups;
}

/** Identifies one finished event; a job that finishes again later gets a new key. */
export const seenKey = (job: JobItem): string => `${job.id}@${job.finishedAt ?? ''}`;

/** Done or failed (not user-stopped) jobs that finished within the last 24 hours and have not been seen. Never the campaign. */
export function unseenFinished(items: JobItem[], seen: ReadonlySet<string>, now: Date): JobItem[] {
  const cutoff = now.getTime() - RECENT_FINISH_HOURS * HOUR_MS;
  return items.filter((j) => j.kind !== 'campaign' && (j.state === 'done' || j.state === 'failed')
    && !Number.isNaN(time(j.finishedAt)) && time(j.finishedAt) >= cutoff && !seen.has(seenKey(j)));
}

export interface NotifyLine { key: string; jobId: string; tone: 'needs_you' | 'running' | 'finished'; text: string; href: string; dismissible: boolean }

export function notifyLines(items: JobItem[], seen: ReadonlySet<string>, now: Date, max = 3): { lines: NotifyLine[]; more: number } {
  const real = items.filter((j) => j.kind !== 'campaign');
  const all: NotifyLine[] = [
    ...real.filter((j) => j.state === 'needs_you').sort(byStartedDesc)
      .map((j): NotifyLine => ({ key: `need:${j.id}`, jobId: j.id, tone: 'needs_you', text: `${j.title}: ${j.detail}`, href: j.href, dismissible: false })),
    ...real.filter((j) => j.state === 'running').sort(byStartedDesc)
      .map((j): NotifyLine => ({ key: `run:${j.id}`, jobId: j.id, tone: 'running', text: `${j.title}: ${j.detail}`, href: j.href, dismissible: false })),
    ...unseenFinished(real, seen, now).sort(byFinishedDesc)
      .map((j): NotifyLine => ({ key: seenKey(j), jobId: j.id, tone: 'finished', text: `${j.title}: ${j.state === 'failed' ? 'did not finish' : 'finished'}`, href: j.href, dismissible: true })),
  ];
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** Needs-you jobs plus unseen recent finished jobs (never running, never the campaign). */
export function tabTitleCount(items: JobItem[], seen: ReadonlySet<string>, now: Date): number {
  return items.filter((j) => j.kind !== 'campaign' && j.state === 'needs_you').length + unseenFinished(items, seen, now).length;
}

export const tabTitle = (count: number, base = 'Dreamlabs Sales'): string => (count > 0 ? `(${count}) ${base}` : base);

/** "3 jobs, 1 needs you" for a phone, or null when there is nothing to say. */
export function summaryLine(items: JobItem[], seen: ReadonlySet<string>, now: Date): string | null {
  const real = items.filter((j) => j.kind !== 'campaign');
  const needs = real.filter((j) => j.state === 'needs_you').length;
  const total = needs + real.filter((j) => j.state === 'running').length + unseenFinished(real, seen, now).length;
  if (total === 0) return null;
  return `${total} ${total === 1 ? 'job' : 'jobs'}${needs > 0 ? `, ${needs} ${needs === 1 ? 'needs' : 'need'} you` : ''}`;
}

export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/jobs`
Expected: PASS for model, view and seen.

- [ ] **Step 5: Whole suite, type-check, commit**

Run: `npx vitest run` and `npx tsc --noEmit`

```bash
git add src/lib/jobs/view.ts src/lib/jobs/view.test.ts src/lib/jobs/seen.ts src/lib/jobs/seen.test.ts
git commit -m "feat: job view helpers (grouping, notification lines, tab title, seen storage)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration 060 and delete audit (files only)

**Files:**
- Create: `supabase/migrations/060_deep_find_run_delete.sql`
- Create: `supabase/audits/jobs_delete_rls.sql`

**Interfaces:**
- Consumes: tables `deep_find_runs`, `deep_find_leads`, `leads`, `organizations`, `org_members`, `autopilot_runs`, `scrape_jobs`; helpers `is_org_member(UUID)`, `is_org_admin(UUID)`.
- Produces: a `DELETE` grant and policy on `deep_find_runs`; a rolled-back audit script. **The subagent writes both files only. It must NOT apply the migration or run any SQL.** The controller applies 060 and runs the audit.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/060_deep_find_run_delete.sql`:

```sql
-- 060_deep_find_run_delete.sql
-- Lets people delete FINISHED Deep find runs from the new Jobs page (docs/superpowers/specs/2026-10-14-jobs-tracker-design.md).
--
-- SECURITY NOTES
-- * Before this migration deep_find_runs had NO delete right for browsers (only SELECT and UPDATE of status/cancel_reason).
-- * The new policy lets the run's creator or an organisation admin delete a run, and only when it is not 'active'
--   (stop a running run first). Another organisation's members and anon cannot delete anything.
-- * deep_find_leads rows go with the run through the existing ON DELETE CASCADE (a cascade runs as the table owner, so
--   no grant on deep_find_leads is needed). Leads, contacts already added and email logs are never touched.
-- * Scraper jobs and autopilot runs already have delete rights (scrape_jobs: FOR ALL policies; autopilot_runs: policy
--   autopilot_runs_delete in migration 049). Nothing about them changes.
GRANT DELETE ON public.deep_find_runs TO authenticated;

CREATE POLICY "deep_find_runs_delete" ON public.deep_find_runs FOR DELETE
  USING (is_org_member(org_id) AND status <> 'active' AND (created_by = auth.uid() OR is_org_admin(org_id)));
```

- [ ] **Step 2: Write the rolled-back security audit**

Create `supabase/audits/jobs_delete_rls.sql`:

```sql
-- Rolled-back security audit for migration 060. Expected outcome: an error "JOBS_AUDIT" followed by PASS/FAIL lines.
-- It borrows one existing lead and its organisation (everything is rolled back), adds throwaway users, and creates a
-- second throwaway organisation to prove other organisations cannot delete.
DO $$
DECLARE
  r TEXT := '';
  v_org UUID; v_lead UUID; v_other UUID;
  v_admin UUID := gen_random_uuid(); v_creator UUID := gen_random_uuid(); v_member UUID := gen_random_uuid(); v_outsider UUID := gen_random_uuid();
  v_run_done UUID; v_run_done2 UUID; v_run_active UUID; v_run_admin UUID; v_run_other UUID;
  n INT;
BEGIN
  SELECT id, org_id INTO v_lead, v_org FROM public.leads LIMIT 1;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'JOBS_AUDIT needs at least one lead in the database to borrow'; END IF;
  INSERT INTO public.organizations (name) VALUES ('jobs-audit-other') RETURNING id INTO v_other;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (v_admin, 'jobs-admin@example.invalid'), (v_creator, 'jobs-creator@example.invalid'), (v_member, 'jobs-member@example.invalid'), (v_outsider, 'jobs-outsider@example.invalid')) AS u(id, email);
  INSERT INTO public.org_members (org_id, user_id, role) VALUES
    (v_org, v_admin, 'admin'), (v_org, v_creator, 'contractor'), (v_org, v_member, 'contractor'), (v_other, v_outsider, 'admin');

  -- Runs in the borrowed organisation: two finished by the creator, one active by the creator, one finished by the admin.
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'completed', 1, now()) RETURNING id INTO v_run_done;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'cancelled', 1, now()) RETURNING id INTO v_run_done2;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count) VALUES (v_org, v_creator, 'active', 1) RETURNING id INTO v_run_active;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_admin, 'completed', 1, now()) RETURNING id INTO v_run_admin;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'completed', 1, now()) RETURNING id INTO v_run_other;
  INSERT INTO public.deep_find_leads (run_id, org_id, lead_id, status) VALUES (v_run_done, v_org, v_lead, 'done');

  -- ===== a plain member who did not create the runs =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done2; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 1 a member cannot delete someone else''s finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 1 a member cannot delete someone else''s finished run (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== the creator =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_active; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 2 nobody can delete a running run, even the creator (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 2 unexpected error (' || SQLERRM || ')'; END;
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 3 the creator can delete their own finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 3 creator delete failed (' || SQLERRM || ')'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.deep_find_leads WHERE run_id = v_run_done;
  r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 4 the run''s lead rows went with it (left=' || n || ')';
  SELECT count(*) INTO n FROM public.leads WHERE id = v_lead;
  r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 5 the pipeline lead itself is untouched (rows=' || n || ')';

  -- ===== the organisation admin =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done2; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 6 an organisation admin can delete a member''s finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 6 admin delete failed (' || SQLERRM || ')'; END;
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_active; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 7 an admin cannot delete a running run either (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 7 unexpected error (' || SQLERRM || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== another organisation's admin =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_other; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 8 another organisation''s admin cannot delete (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 8 another organisation''s admin cannot delete (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== anon =====
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_other; r := r || chr(10) || 'FAIL 9 anon could delete';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 9 anon cannot delete (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== existing behaviour unchanged: a plain member still cannot delete an admin's finished run, and can still read =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.deep_find_runs WHERE org_id = v_org;
  r := r || chr(10) || (CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END) || ' 10 members can still read their organisation''s runs (rows=' || n || ')';
  BEGIN UPDATE public.deep_find_runs SET status = 'completed' WHERE id = v_run_admin; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 11 update rights unchanged: a plain member cannot change another''s run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 11 update rights unchanged (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'JOBS_AUDIT%', r;
END $$;
```

- [ ] **Step 3: Check the files only (no database)**

Run: `grep -c "JOBS_AUDIT" supabase/audits/jobs_delete_rls.sql` (expect 3 or more) and `tail -3 supabase/audits/jobs_delete_rls.sql` (expect `END $$;`).
Do NOT run SQL anywhere. Note in your report that 060 has not been applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/060_deep_find_run_delete.sql supabase/audits/jobs_delete_rls.sql
git commit -m "feat: migration 060 (delete right for finished Deep find runs) and delete audit - NOT YET APPLIED

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Data layer (sources and provider)

**Files:**
- Create: `src/lib/jobs/sources.ts`
- Create: `src/hooks/useJobs.tsx`

**Interfaces:**
- Consumes: Task 1 (`JobItem`, `JobKind`, mappers and input types), Task 2 (`groupJobs`, `JobGroups`, `seenKey`, `unseenFinished`, `tabTitle`, `tabTitleCount`, `readSeen`, `writeSeen`), `supabase` from `../lib/supabase`, `useOrg` from `./useOrg` (`currentOrg: { id } | null`), `cancelDeepFind(runId: string): Promise<string | null>` from `../lib/deepFind`, `fetchLogStatuses(ids: string[]): Promise<{ statuses: Map<string, string>; error: string | null }>` from `./useDraftStatuses`.
- Produces (used by Tasks 5 and 6):
  - `interface JobSource { kind: JobKind; watch: Array<{ table: string; byOrg: boolean }>; load(orgId: string): Promise<JobItem[]> }` and `JOB_SOURCES: JobSource[]` and `JOB_TABLE: Partial<Record<JobKind, string>>` (table to delete from, per kind) in `sources.ts`
  - `JobsProvider({ children })` and `useJobs(): JobsContextValue`:
    ```ts
    interface JobsContextValue {
      jobs: JobItem[]; groups: JobGroups; failedKinds: JobKind[]; loading: boolean;
      now: Date; seen: ReadonlySet<string>;
      counts: { needsYou: number; running: number; notify: number };
      refresh(): Promise<void>;
      stop(jobId: string): Promise<string | null>;
      remove(jobId: string): Promise<string | null>;
      clearFinished(): Promise<{ deleted: number; failed: number }>;
      markFinishedSeen(): void;
      dismiss(key: string): void;
    }
    ```
    (`stop`/`remove` resolve to an error sentence or `null` on success.)

This task has no unit test (the repo's vitest is node-only and these are Supabase and React). The pure logic it uses is already tested; the gate is `npx tsc --noEmit`, `npm run build`, the full suite, and the live check in Task 7.

- [ ] **Step 1: Write `src/lib/jobs/sources.ts`**

```ts
// src/lib/jobs/sources.ts
// One adapter per run type. Each loads recent rows for an organisation and maps them to JobItem with the pure mappers
// in ./model. Sub-project C adds a job type by appending one adapter to JOB_SOURCES.
import { supabase } from '../supabase';
import { fetchLogStatuses } from '../../hooks/useDraftStatuses';
import {
  mapCampaign, mapDeepFind, mapScrape, mapSelectedOutreach,
  type DeepFindLeadInput, type DeepFindRunInput, type JobItem, type JobKind, type SelectedLeadInput, type SelectedRunInput, type ScrapeJobInput, type CampaignRunInput,
} from './model';

export interface JobSource {
  kind: JobKind;
  /** Tables to listen to for live updates (byOrg: the table has an org_id column the realtime filter can use). */
  watch: Array<{ table: string; byOrg: boolean }>;
  load(orgId: string): Promise<JobItem[]>;
}

/** The table a job of each kind is deleted from (the campaign is read-only and has none). */
export const JOB_TABLE: Partial<Record<JobKind, string>> = {
  deep_find: 'deep_find_runs',
  selected_outreach: 'autopilot_runs',
  scrape: 'scrape_jobs',
};

const WINDOW_DAYS = 60;
const MAX_JOBS = 100;
const sinceIso = () => new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(what: string, message: string): never {
  throw new Error(`${what}: ${message}`);
}

// ---------- Deep find ----------
interface DeepFindLeadRow {
  run_id: string; status: DeepFindLeadInput['status']; people_found: number; domains: unknown;
  lead: { business_name: string | null; company_number: string | null } | null;
}

const deepFind: JobSource = {
  kind: 'deep_find',
  watch: [{ table: 'deep_find_runs', byOrg: true }, { table: 'deep_find_leads', byOrg: true }],
  async load(orgId) {
    const { data: runData, error } = await supabase.from('deep_find_runs')
      .select('id, status, lead_count, started_at, finished_at')
      .eq('org_id', orgId).gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('deep find runs', error.message);
    const runs = (runData as DeepFindRunInput[] | null) ?? [];
    const byRun = new Map<string, DeepFindLeadInput[]>();
    for (const ids of chunk(runs.map((r) => r.id), 20)) {
      const { data, error: leadErr } = await supabase.from('deep_find_leads')
        .select('run_id, status, people_found, domains, lead:leads(business_name, company_number)')
        .in('run_id', ids).limit(1000);
      if (leadErr) fail('deep find leads', leadErr.message);
      for (const row of (data as unknown as DeepFindLeadRow[] | null) ?? []) {
        const list = byRun.get(row.run_id) ?? [];
        list.push({ status: row.status, people_found: row.people_found, domains: row.domains, business_name: row.lead?.business_name ?? null, company_number: row.lead?.company_number ?? null });
        byRun.set(row.run_id, list);
      }
    }
    return runs.map((run) => mapDeepFind(run, byRun.get(run.id) ?? []));
  },
};

// ---------- Selected-leads outreach ----------
interface SelectedLeadRow { run_id: string; status: string; email_log_id: string | null; updated_at: string; lead: { business_name: string | null } | null }

const selectedOutreach: JobSource = {
  kind: 'selected_outreach',
  watch: [{ table: 'autopilot_runs', byOrg: true }, { table: 'autopilot_run_leads', byOrg: true }],
  async load(orgId) {
    const { data: runData, error } = await supabase.from('autopilot_runs')
      .select('id, status, started_at')
      .eq('org_id', orgId).eq('mode', 'selected').gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('selected runs', error.message);
    const runs = (runData as SelectedRunInput[] | null) ?? [];
    const byRun = new Map<string, SelectedLeadInput[]>();
    for (const ids of chunk(runs.map((r) => r.id), 10)) {
      const { data, error: leadErr } = await supabase.from('autopilot_run_leads')
        .select('run_id, status, email_log_id, updated_at, lead:leads(business_name)')
        .in('run_id', ids).limit(1000);
      if (leadErr) fail('selected run leads', leadErr.message);
      for (const row of (data as unknown as SelectedLeadRow[] | null) ?? []) {
        const list = byRun.get(row.run_id) ?? [];
        list.push({ status: row.status, email_log_id: row.email_log_id, business_name: row.lead?.business_name ?? null, updated_at: row.updated_at });
        byRun.set(row.run_id, list);
      }
    }
    // Same rule as the sidebar's Autopilot badge: a needs-input lead only needs the user while its parked draft is unsent.
    const logIds = [...byRun.values()].flat().filter((l) => l.status === 'needs_input' && l.email_log_id !== null).map((l) => l.email_log_id as string);
    const logs = await fetchLogStatuses([...new Set(logIds)]);
    if (logs.error) fail('draft statuses', logs.error);
    return runs.map((run) => mapSelectedOutreach(run, byRun.get(run.id) ?? [], logs.statuses));
  },
};

// ---------- Scraper ----------
const scrape: JobSource = {
  kind: 'scrape',
  watch: [{ table: 'scrape_jobs', byOrg: true }, { table: 'raw_leads', byOrg: false }],
  async load(orgId) {
    const { data, error } = await supabase.from('scrape_jobs')
      .select('id, status, icp_raw_input, results_count, approved_count, started_at, completed_at, created_at')
      .eq('org_id', orgId).gte('created_at', sinceIso()).order('created_at', { ascending: false }).limit(MAX_JOBS);
    if (error) fail('scraper jobs', error.message);
    const jobs = (data as ScrapeJobInput[] | null) ?? [];
    // Only completed jobs that produced more results than were approved can still have results waiting.
    const candidates = jobs.filter((j) => j.status === 'completed' && j.results_count > j.approved_count).slice(0, 40);
    const pending = new Map<string, number>();
    await Promise.all(candidates.map(async (job) => {
      const { count, error: countErr } = await supabase.from('raw_leads')
        .select('id', { count: 'exact', head: true }).eq('scrape_job_id', job.id).eq('status', 'pending');
      if (countErr) fail('scraper results', countErr.message);
      pending.set(job.id, count ?? 0);
    }));
    return jobs.map((job) => mapScrape(job, pending.get(job.id) ?? 0));
  },
};

// ---------- Scheduled Autopilot campaign (read-only) ----------
const campaign: JobSource = {
  kind: 'campaign',
  watch: [{ table: 'autopilot_runs', byOrg: true }],
  async load(orgId) {
    const { data, error } = await supabase.from('autopilot_runs')
      .select('id, status, started_at, ends_at, duration_days')
      .eq('org_id', orgId).eq('mode', 'discover').gte('started_at', sinceIso()).order('started_at', { ascending: false }).limit(20);
    if (error) fail('campaigns', error.message);
    const now = new Date();
    return ((data as CampaignRunInput[] | null) ?? []).map((run) => mapCampaign(run, now));
  },
};

export const JOB_SOURCES: JobSource[] = [deepFind, selectedOutreach, scrape, campaign];
```

- [ ] **Step 2: Write `src/hooks/useJobs.tsx`**

```tsx
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { cancelDeepFind } from '../lib/deepFind';
import { JOB_SOURCES, JOB_TABLE } from '../lib/jobs/sources';
import { isFinishedState, type JobItem, type JobKind } from '../lib/jobs/model';
import { groupJobs, seenKey, tabTitle, tabTitleCount, unseenFinished, type JobGroups } from '../lib/jobs/view';
import { readSeen, writeSeen } from '../lib/jobs/seen';
import { useOrg } from './useOrg';

const POLL_MS = 30_000;
const CLOCK_MS = 60_000;
const DEBOUNCE_MS = 600;
const BASE_TITLE = 'Dreamlabs Sales';

export interface JobsContextValue {
  jobs: JobItem[];
  groups: JobGroups;
  failedKinds: JobKind[];
  loading: boolean;
  now: Date;
  seen: ReadonlySet<string>;
  counts: { needsYou: number; running: number; notify: number };
  refresh(): Promise<void>;
  stop(jobId: string): Promise<string | null>;
  remove(jobId: string): Promise<string | null>;
  clearFinished(): Promise<{ deleted: number; failed: number }>;
  markFinishedSeen(): void;
  dismiss(key: string): void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const storage = (): Storage | null => {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
};

/**
 * One instance for the whole signed-in app (mounted in AppShell). Loads every job source, keeps them live (realtime plus a
 * 30 s refetch), exposes the actions, owns the per-browser "seen" state and keeps the tab title in step. A source that
 * fails to load keeps its previously shown rows and is reported in failedKinds; the others are never hidden.
 */
export function JobsProvider({ children }: { children: ReactNode }) {
  const { currentOrg } = useOrg();
  const orgId = currentOrg?.id ?? null;
  const instance = useId();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [failedKinds, setFailedKinds] = useState<JobKind[]>([]);
  const [loading, setLoading] = useState(orgId !== null);
  const [now, setNow] = useState(() => new Date());
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const jobsRef = useRef<JobItem[]>([]);
  const tokenRef = useRef(0);
  jobsRef.current = jobs;

  const load = useCallback(async () => {
    if (!orgId) return;
    const token = tokenRef.current;
    const results = await Promise.allSettled(JOB_SOURCES.map((s) => s.load(orgId)));
    if (token !== tokenRef.current) return; // organisation changed meanwhile: drop the late answer
    const next: JobItem[] = [];
    const failed: JobKind[] = [];
    results.forEach((r, i) => {
      const kind = JOB_SOURCES[i]!.kind;
      if (r.status === 'fulfilled') next.push(...r.value);
      else {
        console.error(`jobs: ${kind} failed to load:`, r.reason instanceof Error ? r.reason.message : 'unknown');
        failed.push(kind);
        next.push(...jobsRef.current.filter((j) => j.kind === kind)); // keep what was already on screen
      }
    });
    next.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    setJobs(next);
    setFailedKinds(failed);
    setLoading(false);
  }, [orgId]);

  // Organisation change: start from nothing, load seen state for that organisation.
  useEffect(() => {
    tokenRef.current += 1;
    setJobs([]);
    setFailedKinds([]);
    setLoading(orgId !== null);
    setSeen(orgId ? readSeen(storage(), orgId) : new Set());
  }, [orgId]);

  // Live updates: realtime (debounced) plus a refetch every 30 s, and a clock for "x minutes ago" and the 14-day cut-off.
  useEffect(() => {
    if (!orgId) return;
    void load();
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { timer = null; void load(); }, DEBOUNCE_MS);
    };
    let channel = supabase.channel(`jobs-${orgId}-${instance}`);
    const seenTables = new Set<string>();
    for (const source of JOB_SOURCES) {
      for (const w of source.watch) {
        const id = `${w.table}:${w.byOrg}`;
        if (seenTables.has(id)) continue;
        seenTables.add(id);
        channel = channel.on('postgres_changes',
          { event: '*', schema: 'public', table: w.table, ...(w.byOrg ? { filter: `org_id=eq.${orgId}` } : {}) }, schedule);
      }
    }
    channel.subscribe();
    const poll = window.setInterval(() => void load(), POLL_MS);
    const clock = window.setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(poll);
      window.clearInterval(clock);
      void supabase.removeChannel(channel);
    };
  }, [orgId, instance, load]);

  const groups = useMemo(() => groupJobs(jobs, now), [jobs, now]);
  const counts = useMemo(() => ({
    needsYou: jobs.filter((j) => j.kind !== 'campaign' && j.state === 'needs_you').length,
    running: jobs.filter((j) => j.kind !== 'campaign' && j.state === 'running').length,
    notify: tabTitleCount(jobs, seen, now),
  }), [jobs, seen, now]);

  // Tab title: "(N) Dreamlabs Sales" while something needs the user or has just finished.
  useEffect(() => {
    document.title = tabTitle(counts.notify, BASE_TITLE);
    return () => { document.title = BASE_TITLE; };
  }, [counts.notify]);

  const persistSeen = useCallback((next: Set<string>) => {
    setSeen(next);
    if (orgId) writeSeen(storage(), orgId, next);
  }, [orgId]);

  const markFinishedSeen = useCallback(() => {
    const fresh = unseenFinished(jobsRef.current, seen, new Date());
    if (fresh.length === 0) return;
    persistSeen(new Set([...seen, ...fresh.map(seenKey)]));
  }, [seen, persistSeen]);

  const dismiss = useCallback((key: string) => {
    if (seen.has(key)) return;
    persistSeen(new Set([...seen, key]));
  }, [seen, persistSeen]);

  const stop = useCallback(async (jobId: string): Promise<string | null> => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    if (!job || !job.canStop) return 'This job cannot be stopped.';
    let err: string | null = null;
    if (job.kind === 'deep_find') err = await cancelDeepFind(job.sourceId);
    else if (job.kind === 'selected_outreach') {
      const { error } = await supabase.from('autopilot_runs').update({ status: 'cancelled', cancel_reason: 'stopped by user' }).eq('id', job.sourceId).eq('status', 'active');
      err = error ? 'Could not stop this job. Try again.' : null;
    } else err = 'This job cannot be stopped.';
    await load();
    return err;
  }, [load]);

  const remove = useCallback(async (jobId: string): Promise<string | null> => {
    const job = jobsRef.current.find((j) => j.id === jobId);
    const table = job ? JOB_TABLE[job.kind] : undefined;
    if (!job || !table || !job.canDelete) return 'This job cannot be deleted.';
    const { data, error } = await supabase.from(table).delete().eq('id', job.sourceId).select('id');
    if (error) {
      console.error('jobs: delete failed:', error.message);
      return 'Could not delete this job. Try again.';
    }
    if (!data || data.length === 0) {
      // Zero rows: already gone, or not allowed. Look to tell the two apart.
      const { data: still } = await supabase.from(table).select('id').eq('id', job.sourceId).maybeSingle();
      if (still) return 'You are not allowed to delete this job. Only its creator or an organisation admin can.';
    }
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
    return null;
  }, []);

  const clearFinished = useCallback(async () => {
    const targets = jobsRef.current.filter((j) => isFinishedState(j.state) && j.canDelete);
    let deleted = 0;
    let failed = 0;
    for (const job of targets) {
      const err = await remove(job.id);
      if (err) failed += 1; else deleted += 1;
    }
    return { deleted, failed };
  }, [remove]);

  const value = useMemo<JobsContextValue>(() => ({
    jobs, groups, failedKinds, loading, now, seen, counts, refresh: load, stop, remove, clearFinished, markFinishedSeen, dismiss,
  }), [jobs, groups, failedKinds, loading, now, seen, counts, load, stop, remove, clearFinished, markFinishedSeen, dismiss]);

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used inside JobsProvider');
  return ctx;
}
```

- [ ] **Step 3: Type-check, build, run the suite**

Run: `npx tsc --noEmit`, `npm run build`, `npx vitest run`
Expected: all clean. If `tsc` objects to the `.select('id')` on `delete()` or to realtime `channel.on` chaining, keep behaviour identical and adjust only types (a narrow cast), and say so in the report. The tab-title effect and `useId` channel name are required by the Global Constraints.

- [ ] **Step 4: Commit**

```bash
git add src/lib/jobs/sources.ts src/hooks/useJobs.tsx
git commit -m "feat: jobs data layer (four adapters and the JobsProvider)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Jobs page, routes, sidebar

**Files:**
- Create: `src/components/jobs/ConfirmDialog.tsx`, `src/components/jobs/JobRow.tsx`, `src/pages/Jobs.tsx`
- Modify: `src/App.tsx`, `src/components/deepfind/DeepFindRunsLink.tsx`, `src/components/layout/Sidebar.tsx`
- Delete: `src/pages/DeepFindRuns.tsx`

**Interfaces:**
- Consumes: `useJobs()` and `JobsContextValue` (Task 4), `JobItem`/`JobState` (Task 1), `timeAgo` (Task 2), existing `Modal` (`{ open, onClose, title, children }`), `Button` (variants `primary | secondary | ghost | danger`, props `loading`), `Card`, `Skeleton`, `EmptyState` (`{ icon, title, hint }`), `useOrg`.
- Produces: route `/jobs`; `ConfirmDialog({ open, title, body, warning?, confirmLabel, onConfirm: () => Promise<void> | void, onClose })`; `JobRow({ job, now, onStop, onDelete })`.

**Prerequisite:** `JobsProvider` must wrap the routes. This task mounts it in `AppShell` (the same edit Task 6 builds on); Task 6 adds the bar next to it.

- [ ] **Step 1: Mount the provider in `AppShell`**

In `src/components/layout/AppShell.tsx` add `import { JobsProvider } from '../../hooks/useJobs';` and wrap the existing content so the file reads:

```tsx
import { Outlet } from 'react-router';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { useFocusMode } from '../../hooks/useFocusMode';
import { ThemeProvider } from '../../hooks/useTheme';
import { JobsProvider } from '../../hooks/useJobs';

/** Main authenticated layout; focus mode hides all navigation chrome. */
export function AppShell() {
  const { focusMode } = useFocusMode();
  return (
    <ThemeProvider>
      <JobsProvider>
        <div className="flex min-h-screen">
          {!focusMode && <Sidebar />}
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
              <Outlet />
            </main>
          </div>
          {!focusMode && <MobileNav />}
        </div>
      </JobsProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Create `ConfirmDialog`**

`src/components/jobs/ConfirmDialog.tsx`:

```tsx
import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What is about to happen, in plain words. */
  body: string;
  /** An extra warning sentence (shown separately), or null. */
  warning?: string | null;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** In-page confirmation (never window.confirm): Cancel and a danger button; the danger button shows a spinner while it works. */
export function ConfirmDialog({ open, title, body, warning = null, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={title}>
      <div className="flex flex-col gap-3">
        <p className="text-sm">{body}</p>
        {warning && <p className="text-sm text-muted">{warning}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => void confirm()}>{confirmLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 3: Create `JobRow`**

`src/components/jobs/JobRow.tsx`:

```tsx
import { Link } from 'react-router';
import { Button } from '../ui/Button';
import { timeAgo } from '../../lib/jobs/view';
import type { JobItem, JobState } from '../../lib/jobs/model';

// Text is always the normal text colour; only the dot is coloured (cyan or green text fails contrast on the light theme).
const BADGE: Record<JobState, { label: string; dot: string }> = {
  needs_you: { label: 'Needs you', dot: 'bg-violet' },
  running: { label: 'Running', dot: 'bg-cyan' },
  done: { label: 'Done', dot: 'bg-success' },
  failed: { label: 'Did not finish', dot: 'bg-danger' },
  stopped: { label: 'Stopped', dot: 'bg-muted' },
};

const KIND_LABEL: Record<JobItem['kind'], string> = {
  deep_find: 'Deep find',
  selected_outreach: 'Outreach to selected leads',
  scrape: 'Lead search',
  campaign: 'Autopilot',
};

interface JobRowProps {
  job: JobItem;
  now: Date;
  stopping: boolean;
  error: string | null;
  onStop: () => void;
  onDelete: () => void;
}

/** One job: state badge in words, what it works on, one plain line, progress, when, and its actions. */
export function JobRow({ job, now, stopping, error, onStop, onDelete }: JobRowProps) {
  const badge = BADGE[job.state];
  const pct = job.progress && job.progress.total > 0 ? Math.min(100, Math.round((job.progress.done / job.progress.total) * 100)) : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-offwhite">
          <span className={`h-2 w-2 rounded-full ${badge.dot}`} aria-hidden />
          {badge.label}
        </span>
        <span className="text-xs text-muted">{KIND_LABEL[job.kind]}</span>
        <span className="text-xs text-muted">Started {timeAgo(job.startedAt, now)}</span>
      </div>
      <Link to={job.href} className="text-[15px] font-bold hover:underline">{job.title}</Link>
      <p className="text-sm text-muted">{job.detail}</p>
      {pct !== null && (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${job.title} progress`}>
          <div className="h-full bg-violet" style={{ width: `${pct}%` }} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Link to={job.href} className="flex min-h-11 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold hover:bg-surface/70">Open</Link>
        {job.canStop && <Button variant="secondary" loading={stopping} onClick={onStop}>Stop</Button>}
        {job.canDelete && <Button variant="ghost" onClick={onDelete}>Delete</Button>}
      </div>
    </li>
  );
}
```

- [ ] **Step 4: Create the Jobs page**

`src/pages/Jobs.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { useJobs } from '../hooks/useJobs';
import { JobRow } from '../components/jobs/JobRow';
import { ConfirmDialog } from '../components/jobs/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { isFinishedState, type JobItem, type JobKind } from '../lib/jobs/model';

const KIND_NAME: Record<JobKind, string> = { deep_find: 'Deep find', selected_outreach: 'Outreach to selected leads', scrape: 'Lead searches', campaign: 'Autopilot campaigns' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[18px] font-bold">{title}</h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/** /jobs: every background job of the current organisation, named by its leads, grouped by what needs attention. */
export function Jobs() {
  const { jobs, groups, failedKinds, loading, now, remove, stop, clearFinished, markFinishedSeen } = useJobs();
  const [toDelete, setToDelete] = useState<JobItem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [stopping, setStopping] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Opening this page counts as having seen everything that finished.
  useEffect(() => { markFinishedSeen(); }, [markFinishedSeen, jobs]);

  const clearable = jobs.filter((j) => isFinishedState(j.state) && j.canDelete);

  async function doDelete(job: JobItem) {
    const err = await remove(job.id);
    setToDelete(null);
    setRowErrors((prev) => { const next = { ...prev }; if (err) next[job.id] = err; else delete next[job.id]; return next; });
  }

  async function doStop(job: JobItem) {
    setStopping(job.id);
    const err = await stop(job.id);
    setStopping(null);
    setRowErrors((prev) => { const next = { ...prev }; if (err) next[job.id] = err; else delete next[job.id]; return next; });
  }

  async function doClear() {
    const { deleted, failed } = await clearFinished();
    setConfirmClear(false);
    setNotice(failed > 0 ? `Deleted ${deleted}. ${failed} could not be deleted (only a job's creator or an organisation admin can).` : `Deleted ${deleted} finished ${deleted === 1 ? 'job' : 'jobs'}.`);
  }

  const row = (job: JobItem) => (
    <JobRow key={job.id} job={job} now={now} stopping={stopping === job.id} error={rowErrors[job.id] ?? null}
      onStop={() => void doStop(job)} onDelete={() => setToDelete(job)} />
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[28px] font-extrabold">Jobs</h1>
        {clearable.length > 0 && <Button variant="secondary" onClick={() => setConfirmClear(true)}>Clear finished ({clearable.length})</Button>}
      </div>
      <p className="text-sm text-muted">Everything that works in the background, named by the leads it is working on. Jobs that need you stay at the top.</p>

      {failedKinds.map((kind) => (
        <p key={kind} role="alert" className="text-sm text-danger">{KIND_NAME[kind]} could not be loaded right now. The rest are shown.</p>
      ))}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}

      {loading && <Skeleton className="h-40 w-full" />}
      {!loading && jobs.length === 0 && failedKinds.length === 0 && (
        <EmptyState icon={ListChecks} title="No background jobs yet" hint="Deep find, outreach to selected leads and lead searches show up here while they work." />
      )}

      {groups.needsYou.length > 0 && <Section title="Needs you">{groups.needsYou.map(row)}</Section>}
      {groups.running.length > 0 && <Section title="Running">{groups.running.map(row)}</Section>}
      {groups.finished.length > 0 && <Section title="Finished">{groups.finished.map(row)}</Section>}
      {groups.older.length > 0 && (
        <section className="flex flex-col gap-2">
          <Button variant="ghost" className="self-start" aria-expanded={showOlder} onClick={() => setShowOlder((v) => !v)}>
            {showOlder ? 'Hide' : 'Show'} {groups.older.length} older {groups.older.length === 1 ? 'job' : 'jobs'} (over 14 days)
          </Button>
          {showOlder && <ul className="flex flex-col gap-2">{groups.older.map(row)}</ul>}
        </section>
      )}
      <p className="text-xs text-muted">Shows the last 60 days (up to 100 jobs of each kind). Older jobs are still stored.</p>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this job?"
        body={toDelete ? `“${toDelete.title}” will be removed from your list.` : ''}
        warning={toDelete?.deleteWarning ?? null}
        confirmLabel="Delete"
        onConfirm={() => (toDelete ? doDelete(toDelete) : undefined)}
        onClose={() => setToDelete(null)}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear finished jobs?"
        body={`${clearable.length} finished, failed or stopped ${clearable.length === 1 ? 'job' : 'jobs'} will be deleted. Jobs that are running or need you are not touched.`}
        warning="Leads in your pipeline, people already added, and sent emails stay. Results you have not reviewed in finished searches are removed."
        confirmLabel={`Delete ${clearable.length}`}
        onConfirm={doClear}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
```

(`Button` accepts `className` and the standard button attributes, as in `Settings.tsx`; if `aria-expanded` is not forwarded because `Button` spreads `...rest`, it is — it spreads `rest`. If `EmptyState`'s props differ from `{ icon, title, hint }`, match the existing usage in the old `DeepFindRuns.tsx` page before deleting it.)

- [ ] **Step 5: Wire routes, the redirect, the link and the sidebar**

In `src/App.tsx`: change `import { BrowserRouter, Route, Routes, useNavigate } from 'react-router';` to also import `Navigate`; replace the line `import { DeepFindRuns } from './pages/DeepFindRuns';` with `import { Jobs } from './pages/Jobs';`; replace the route `<Route path="/pipeline/deep-find" element={<DeepFindRuns />} />` with:

```tsx
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/pipeline/deep-find" element={<Navigate to="/jobs" replace />} />
```

(keep the `/pipeline/deep-find/:runId` route as is).

Delete `src/pages/DeepFindRuns.tsx` (`git rm src/pages/DeepFindRuns.tsx`). First confirm nothing else imports it: `grep -rn "DeepFindRuns'" src` must show only the old import you removed.

In `src/components/deepfind/DeepFindRunsLink.tsx` change `to="/pipeline/deep-find"` to `to="/jobs"` and the visible label `Deep find runs` to `Jobs`.

In `src/components/layout/Sidebar.tsx`: add `ListChecks` to the lucide import; import `useJobs` (`import { useJobs } from '../../hooks/useJobs';`); add after the Pipeline item in `NAV_ITEMS`: `{ to: '/jobs', label: 'Jobs', icon: ListChecks },`; inside `Sidebar()` add `const { counts } = useJobs();`; and inside the `NavLink` body, after the existing autopilot badge expression, add:

```tsx
            {to === '/jobs' && counts.needsYou > 0 ? (
              <span className="ml-auto rounded-full bg-violet px-2 py-0.5 text-[11px] font-bold text-on-accent" aria-label={`${counts.needsYou} jobs need you`}>{counts.needsYou}</span>
            ) : null}
```

- [ ] **Step 6: Type-check, build, run the suite**

Run: `npx tsc --noEmit`, `npm run build`, `npx vitest run`
Expected: all clean (the existing 1,200+ tests still pass; nothing imports the deleted page).

- [ ] **Step 7: Commit**

```bash
git add src/components/jobs/ConfirmDialog.tsx src/components/jobs/JobRow.tsx src/pages/Jobs.tsx src/App.tsx src/components/deepfind/DeepFindRunsLink.tsx src/components/layout/Sidebar.tsx src/components/layout/AppShell.tsx
git rm -q src/pages/DeepFindRuns.tsx
git commit -m "feat: Jobs page (grouped, named, delete and clear), route, redirect and sidebar count

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Notification bar

**Files:**
- Create: `src/components/jobs/JobsBar.tsx`
- Modify: `src/components/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `useJobs()` (`jobs`, `seen`, `now`, `dismiss`) from Task 4; `notifyLines`, `summaryLine`, `NotifyLine` from Task 2; `useFocusMode` (already used by `AppShell`).
- Produces: `<JobsBar />` rendered inside `AppShell` under `TopBar` and hidden in focus mode.

No unit test (React, no DOM test setup); the pure lines and summary are tested in Task 2. Gate: `tsc`, build, suite, live check.

- [ ] **Step 1: Create the bar**

`src/components/jobs/JobsBar.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { X } from 'lucide-react';
import { useJobs } from '../../hooks/useJobs';
import { notifyLines, summaryLine, type NotifyLine } from '../../lib/jobs/view';

const DOT: Record<NotifyLine['tone'], string> = { needs_you: 'bg-violet', running: 'bg-cyan', finished: 'bg-success' };
const TONE_WORD: Record<NotifyLine['tone'], string> = { needs_you: 'Needs you', running: 'Running', finished: 'Finished' };

/**
 * Top-of-screen notification bar: what needs the user (cannot be dismissed), what is running, and what just finished
 * (dismissible). At most three lines; one summary line on a phone. Text is always in the normal text colour with a
 * coloured dot, a polite live region announces only newly appearing needs-you and finished lines, it never takes focus,
 * and it adds no animation.
 */
export function JobsBar() {
  const { jobs, seen, now, dismiss } = useJobs();
  const { lines, more } = useMemo(() => notifyLines(jobs, seen, now), [jobs, seen, now]);
  const summary = useMemo(() => summaryLine(jobs, seen, now), [jobs, seen, now]);

  // Announce only lines that were not there before (never the running progress ticks).
  const announcedRef = useRef<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const fresh = lines.filter((l) => l.tone !== 'running' && !announcedRef.current.has(l.key));
    lines.forEach((l) => announcedRef.current.add(l.key));
    if (fresh.length > 0) setAnnouncement(fresh.map((l) => `${TONE_WORD[l.tone]}: ${l.text}`).join('. '));
  }, [lines]);

  return (
    <>
      <span role="status" className="sr-only">{announcement}</span>
      {lines.length > 0 && (
        <div role="region" aria-label="Background jobs" className="border-b border-line bg-card px-4 py-2">
          <ul className="hidden flex-col gap-1 sm:flex">
            {lines.map((line) => (
              <li key={line.key} className="flex items-center gap-3 text-sm">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[line.tone]}`} aria-hidden />
                <span className="font-semibold">{TONE_WORD[line.tone]}</span>
                <span className="min-w-0 flex-1 truncate">{line.text}</span>
                <Link to={line.href} className="shrink-0 font-semibold underline">{line.tone === 'needs_you' ? 'Open' : 'View'}</Link>
                {line.dismissible && (
                  <button type="button" onClick={() => dismiss(line.key)} aria-label={`Dismiss: ${line.text}`} className="flex min-h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:text-offwhite">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
            {more > 0 && <li className="text-sm text-muted"><Link to="/jobs" className="underline">+{more} more</Link></li>}
          </ul>
          {summary && (
            <Link to="/jobs" className="flex items-center gap-3 text-sm font-semibold sm:hidden">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[lines[0]!.tone]}`} aria-hidden />
              {summary}
              <span className="ml-auto underline">View</span>
            </Link>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Mount it in `AppShell`**

In `src/components/layout/AppShell.tsx` add `import { JobsBar } from '../jobs/JobsBar';` and render it between `<TopBar />` and `<main>`, hidden in focus mode:

```tsx
            <TopBar />
            {!focusMode && <JobsBar />}
            <main className="flex-1 p-4 pb-20 md:p-6 md:pb-6">
```

- [ ] **Step 3: Type-check, build, run the suite**

Run: `npx tsc --noEmit`, `npm run build`, `npx vitest run`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/jobs/JobsBar.tsx src/components/layout/AppShell.tsx
git commit -m "feat: notification bar (needs you, running, finished) under the top bar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Apply, verify live and document (controller or Kevin, not a subagent)

**Files:**
- Modify: `CLAUDE.md`, `docs/AUTOMATIONS.md`

**Interfaces:**
- Consumes: everything above, and the live project `wgomksxelyfkzepbnkdd`.

This task changes the live database and the live site, so it is done by the controller (or Kevin) after the code tasks pass review. Subagents do not run it.

- [ ] **Step 1: Whole-branch review.** Build the review package and dispatch an independent read-only reviewer on the most capable model with the spec, this plan, the plan's Review Focus verbatim, and the ledger rulings. Fix Critical and Important findings in one TDD pass.

- [ ] **Step 2: Apply migration 060** (SQL editor or `apply_migration` once permitted; show Kevin the file first). Expected: "Success. No rows returned".

- [ ] **Step 3: Run `supabase/audits/jobs_delete_rls.sql`** through `execute_sql`. Expected: an error starting `JOBS_AUDIT` with 11 `PASS` lines and no `FAIL`. Then confirm nothing remains: no `jobs-audit-%` organisations, no `jobs-%@example.invalid` users or profiles.

- [ ] **Step 4: Push to `main`** (Kevin has authorised merging verified work; fast-forward only), wait for the new bundle on the live site.

- [ ] **Step 5: Live check on the deployed site** (signed in as the account the page shows; look up its organisation first). Check, with screenshots: the Jobs page lists real Deep find runs by lead names; the old `/pipeline/deep-find` redirects; the bar shows a needs-you line for a Deep find that needs the user and shows a running line while a run works; a finished run shows a green line, dismisses with ×, and the tab title reads `(N) Dreamlabs Sales` then clears; Delete asks first, shows the warning, then removes the row and the database row (and its lead rows) are gone while the pipeline lead remains; "Clear finished" states the count and skips needs-you and running jobs; a scraper job deletes; phone-width frame (400 px iframe) shows the one-line summary and no horizontal overflow; light and dark; keyboard (Tab reaches Open, Stop, Delete, dialog buttons; Escape closes the dialog). Browser-test notes from CLAUDE.md apply (screenshot-pixel coordinates; set React input values with the native setter; dispatch `focusin` for focus).

- [ ] **Step 6: Update the docs.** In `CLAUDE.md` add an entry "Jobs tracker and notification bar (2026-10-14)": what shipped, the five planning rulings above, the migration 060 result and audit counts, the adapter rule for sub-project C (append one `JobSource` to `JOB_SOURCES`; add its table to `JOB_TABLE` if it is deletable), and any deferred minors from the review. In `docs/AUTOMATIONS.md` add a row "Jobs tracker (client view over run tables)".

- [ ] **Step 7: Commit and push the docs.**

```bash
git add CLAUDE.md docs/AUTOMATIONS.md
git commit -m "docs: jobs tracker and notification bar live (results, rulings, adapter rule for sub-project C)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
