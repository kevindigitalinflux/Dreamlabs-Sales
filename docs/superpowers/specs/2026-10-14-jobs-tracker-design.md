# Jobs tracker and notification bar (sub-project B of 3) — Design

Date: 2026-10-14. Status: written, awaiting Kevin's review. Nothing built.

Part of the lookup-worker programme (`docs/LOOKUP-TOOLS-PLAN.md`). Order: A. Usage and quotas (live) -> **B. Jobs tracker and notification bar (this spec)** -> C. Worker integration into Deep find, Fill in missing details and Find decision maker.

## Why
Background work is spread over four separate run systems that share no list and no status words. The Deep find runs page shows a start date and counts but never says WHICH leads it is working on, nothing can be deleted so old runs pile up, and there is no notification at all (the only signal is a small badge on one pipeline button). Sub-project C will add more background work, so a shared place to see, name, tidy and be notified about jobs is needed first.

## Understanding Kevin confirmed
1. Every background job names what it is working on (the leads, or the search).
2. Jobs can be deleted, and finished ones do not pile up.
3. A bar at the top of the app says what is running, what needs the user, and what has finished, like Claude Desktop does for chats.
4. Notification surfaces: **in-app bar plus a count in the browser tab title.** No desktop pop-ups in this version.
5. Scope: **all one-off jobs** (Deep find runs, selected-leads outreach runs, scraper jobs). The long scheduled Autopilot campaign shows as a read-only row that links to its own page.
6. Assumptions confirmed by "proceed": finished items older than **14 days** fold away (never auto-deleted); the **creator or an organisation admin** may delete.

## Approach
A **Jobs view built from one small adapter per existing run type**, kept live by a single provider. Not a rewrite of the four systems into one table (risky, no user benefit), and not notifications without a list (cannot show names or delete).

## Out of scope
Desktop pop-ups; automatic deletion; deleting or stopping the scheduled Autopilot campaign from the list; sub-project C's job types (the adapter interface is designed for them); changing how any run actually executes.

## Job model (pure, tested)
`src/lib/jobs/` (pure TypeScript, no React, no Supabase imports so it is unit-tested in node):
```
type JobKind = 'deep_find' | 'selected_outreach' | 'scrape' | 'campaign'
type JobState = 'needs_you' | 'running' | 'done' | 'failed' | 'stopped'
interface JobItem {
  id: string            // `${kind}:${sourceId}`
  kind: JobKind
  sourceId: string
  title: string         // names what it works on, e.g. "Love Living, FMJ Property +3"
  detail: string        // plain words: "2 of 5 leads done", "24 results to review"
  state: JobState
  progress: { done: number; total: number } | null
  needsYou: number      // count that needs the user (0 when none)
  startedAt: string
  finishedAt: string | null
  href: string          // detail page
  canStop: boolean
  canDelete: boolean    // finished, failed or stopped; never running
  deleteWarning: string | null  // extra sentence shown in the confirmation, e.g. unreviewed results are removed too
}
```
State mapping (needs-you wins over running):
| Kind | needs_you | running | done | failed | stopped |
|---|---|---|---|---|---|
| `deep_find` | any lead passes the existing `needsAttention` rule (company to choose or people to check) | run `active` | run `completed` | none | run `cancelled` |
| `selected_outreach` (`autopilot_runs` mode `selected`) | any run lead `needs_input` | run `active` | `completed` | none (failed leads are counted in `detail`) | `cancelled` |
| `scrape` | job `completed` with `raw_leads.status = 'pending'` rows (results to review) | `pending` or `running` | `completed` with nothing left to review | `failed` (error text never shown raw) | none |
| `campaign` (`autopilot_runs` mode `discover`) | none | `active` | `completed` | none | `cancelled`; read-only: `canStop = canDelete = false`, `href = /autopilot` |

Titles: `deep_find` and `selected_outreach` use the first two business names (alphabetical by when they were added) then `+N`, or the single name; `scrape` uses the saved search wording shortened to 60 characters; `campaign` is "Autopilot campaign" with the day count in `detail`. A lead the viewer cannot see (row-level security) is simply not named; the count still includes it only if the rows are returned.

Pure functions (each with unit tests): `nameLeads(names)`, `mapDeepFind(run, leadRows)`, `mapSelectedOutreach(run, runLeads)`, `mapScrape(job, pendingCount)`, `mapCampaign(run)`, `groupJobs(items, now)` (needs_you, running, finished, older: finished items whose `finishedAt` is more than 14 days before `now`), `notifyLines(items, seen)`, `tabTitleCount(items, seen)`.

## Data layer
- `src/lib/jobs/sources.ts`: the adapter registry. An adapter is `{ kind, tables: string[], load(orgId): Promise<JobItem[]> }`. Four adapters ship now; sub-project C adds one by appending to the array.
- `src/hooks/useJobs.tsx` (`JobsProvider`, mounted once in `AppShell`, and `useJobs()`): loads every adapter with `Promise.allSettled` (one failing source shows "<kind> could not be loaded" on the Jobs page and never hides the others), keeps them fresh with a 30 s refetch plus realtime on every adapter's tables, **per-instance channel names via `useId()`**, cleanup of intervals and channels. Returns `{ jobs, groups, failedKinds, loading, remove(jobId), clearFinished(), stop(jobId), refresh() }`.
- Reads cover only the last 60 days and at most 100 jobs per source (older rows are still in the database; the page says so).
- Lead names come from one extra query per kind (`deep_find_leads` and `autopilot_run_leads` joined to `leads(business_name)`); nothing is fetched per row.

## Jobs page and navigation
- New route `/jobs`, sidebar item **Jobs** (between Pipeline and Scraper) with a violet count of needs-you jobs; on a phone it is reached from the notification bar (the three-item mobile nav is unchanged).
- Groups: **Needs you**, **Running**, **Finished**, **Older** (collapsed, "Show 12 older"). Each row: state badge with words, title, detail, progress, "started 2 h ago", and actions **Open**, **Stop** (running Deep finds and selected-leads runs only, using the existing cancel paths), **Delete**.
- **Delete** opens an in-page confirmation (never `window.confirm`) naming the job, with `deleteWarning` when relevant (scrape: "Results you have not reviewed go with it. Leads already approved stay in your pipeline."; Deep find: "People already added to leads stay."). **Clear finished** deletes every finished, failed and stopped job after a confirmation that states the count; needs-you jobs and running jobs are never included. After a delete the row disappears at once and returns with a plain error line if the database refused.
- The old `/pipeline/deep-find` list redirects to `/jobs`; the run detail page `/pipeline/deep-find/:runId` stays. The pipeline toolbar button "Deep find runs" keeps its badge and links to `/jobs`.

## Notification bar
- `JobsBar` renders under the top bar (inside `AppShell`, above `<main>`), hidden when there is nothing to say and in focus mode.
- Lines, in priority order, at most three then "+N more": **Needs you** (violet; persists until resolved and cannot be dismissed), **Running** (blue; names the job and shows progress), **Finished** (green; stays until the user opens `/jobs` or clicks ×). Each line has one action link (Open or View).
- "Seen" state lives only in this browser (`localStorage`, keyed by job id and finish time, wrapped in try/catch, the bar works without it).
- Phone: collapses to one line ("3 jobs, 1 needs you") that links to `/jobs`.
- Accessibility: a polite live region announces only changes (a job becoming needs-you or finished), never the running progress ticks; the bar never takes focus; text states the situation in words (colour only reinforces) and passes 4.5:1 on the card colour in both themes; no animation beyond what `prefers-reduced-motion` allows.
- **Tab title:** `(N) Dreamlabs Sales` where N is the needs-you jobs plus unseen finished jobs; reset to the plain title at zero and on unmount. A pure function computes N; an effect sets `document.title`.

## Database (migration 060, DELETE rights only)
Current state read from the migrations: `scrape_jobs` already has `FOR ALL` policies for the creator and org admins (delete works; it cascades to `raw_leads` only, never to `leads`); `autopilot_runs` already has a delete policy for the creator or an org admin (cascades to `autopilot_run_leads`); **`deep_find_runs` has no delete right at all**.
- Add to `deep_find_runs`: `GRANT DELETE ... TO authenticated` and a `FOR DELETE` policy `is_org_member(org_id) AND status <> 'active' AND (created_by = auth.uid() OR is_org_admin(org_id))` (cascades to `deep_find_leads`). Running runs cannot be deleted; stop them first.
- No other table, policy or grant changes. The UI additionally refuses to offer Delete for running jobs of the other kinds.
- Deleting a job never deletes pipeline leads, contacts already added, sent emails or email logs.

## Error handling and edge cases
- A source that fails to load: its rows are absent and the page shows one line for that source; the bar ignores it.
- A job that disappears between load and click (deleted elsewhere): the delete is treated as done.
- A Deep find that finishes while the page is open moves groups live (realtime), and the bar adds a Finished line.
- Zero jobs: the page shows an empty state; the bar is hidden; the tab title is plain.
- Many jobs: groups scroll within the page; the bar still shows at most three lines.
- Switching organisation clears the previous organisation's jobs and drops any late response for it.

## Testing
- Unit (vitest, node): every pure function above with edge cases: zero, one, two and many leads; a lead with no name; titles over 60 characters; needs-you beating running; scrape job completed with and without pending results; 14-day cut-off exactly at the boundary; `notifyLines` ordering, the three-line cap and seen/unseen; `tabTitleCount`.
- SQL (rolled-back audit in `supabase/audits/`): a member cannot delete another user's Deep find run; the creator can delete a finished run and its lead rows go with it; nobody can delete a running run; an org admin can delete any finished run in their organisation; another organisation's admin cannot; anon cannot; existing select/update behaviour unchanged.
- Browser (live site, like sub-project A): bar lines for each state, tab title, Jobs page grouping, delete with confirmation, Clear finished, phone-width frame, light and dark, keyboard (all actions reachable, confirmation dialog traps and returns focus).

## Success criteria
1. Every job row names its leads or search in plain words.
2. A finished job can be deleted, finished jobs can be cleared in one confirmed action, and nothing running or waiting on the user can be deleted by accident.
3. The bar and tab title show running, needs-you and finished states, and needs-you cannot be missed or dismissed.
4. Adding sub-project C's job type needs one adapter and no change to the page or bar.

## Assumptions to confirm
- Lead names in titles are sorted by when the lead entered the run (first two shown).
- The scheduled Autopilot campaign's detail page already offers its own stop control, so the Jobs page does not duplicate it.
- Realtime plus a 30 s refetch is fast enough (no per-second progress).
