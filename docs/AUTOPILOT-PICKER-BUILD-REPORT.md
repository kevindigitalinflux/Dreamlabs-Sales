# Autopilot selected-leads picker — build report

2026-10-29. Codex is builder and sole writer; Claude remains architect/reviewer. Kevin authorised the local build in `AUTOPILOT-PICKER-BUILD-BRIEF.md`. Independent review is pending.

## Workspace and revisions

Created the requested new worktree with `git worktree add ../dreamlabs-sales-picker -b codex/autopilot-picker origin/main` from the brief checkout. All implementation, dependency installation, tests and documentation changes are in `C:/Users/kevin/Projects/dreamlabs-sales-picker` only. The command resolved `origin/main` to `ac3f979a097fd1c0ba0123e186b9625bb4abc4c6`; no fetch or remote call was made.

Application commits, in order:

- `c29de93`: retain disabled leads and classifier reasons; test-first grouping regressions.
- `e7a5357`: pure combined filters, contact definitions, selection helpers and reason mapping.
- `0ef96a2827f61dfa4985a19d2e3d5ac5f456a663`: picker controls, disclosures, bounded rows and setup integration.

This report and the short dated `HANDOFF.md` section follow in a documentation commit. Its hash is available from `git log`. Each commit uses explicit staged paths, disabled hooks and the required Codex trailer. No other checkout or vault content was edited.

## Behaviour built

The picker offers combined search, pipeline checkboxes with All pipelines, contact status, stages, readiness, verified-email and hide-ineligible controls. Clear filters restores defaults without changing selected IDs. The summary reports matching/loaded counts and active filter choices. Disabled leads remain listed by default, with visible reasons linked to disabled checkboxes. Rows sort eligible first, then business name, then ID for ties; selection does not affect order.

Selection remains one parent-owned set across pipelines. Global and per-pipeline bulk selection operate only on matching eligible leads. Clear selection leaves filters intact. The sticky bar counts selected leads and their pipelines, offers Show only selected, and reports selected leads hidden by filters. Filtering does not prune the stored set. Submission still intersects that set with the complete, unfiltered eligible list through the existing `pruneSelection`; the server rechecks eligibility as before.

After first visiting selected-leads mode, its component stays mounted but hidden when switching to discovery. Filters, search, selection and sending-window state survive these section switches. An organisation change remounts the setup and clears its state. Nothing persists across a page reload.

## Exact filter definitions

| Filter | Definition |
|---|---|
| Search | Primary `business_name`, `owner_name`, `email`, using Pipeline `filterLeads`. Trim and collapse whitespace in both the query and those saved fields; case-insensitive contiguous substring match. City and additional/contact addresses are not searched. |
| Pipeline | Visible pipelines belonging to the current organisation, matching the existing runnable-lead scope. All are checked by default, including empty pipelines. `null` means all, including subsequently loaded pipelines; an explicit empty array means none. Cross-organisation shared pipelines remain outside this existing run scope. |
| Any contact status | No contact/date restriction. Other filters still apply. |
| Never contacted | `last_contacted_at` is null/absent. Stage is not used as a substitute. |
| Contacted before | `last_contacted_at` is non-null, regardless of age or stage. This includes leads outside the engine's 14-day recent-contact exclusion. |
| Due today or overdue | If the chosen enrolment is active, non-null `next_send_at <= endOfLocalDay(now, runTimeZone)`, inclusive of the final millisecond. Otherwise, use `leads.next_action_date` with the Pipeline's `isDueToday`/`isOverdue` helpers, anchored to the calendar date from `localDateString(now, runTimeZone)`. An active enrolment takes precedence over a conflicting lead follow-up date. |
| Not due yet | For active enrolments, the complement of the due test, matching the classifier; an active enrolment without a next-send date is not due. Otherwise, a non-null lead `next_action_date` after the run's calendar date. A lead without either an active enrolment or a follow-up date matches neither date filter. |
| Stage | OR within the selected `STAGES` values, with the existing Pipeline labels and ordering. Empty means any stage. Reuses `filterLeads`. |
| Readiness | OR within stored `leads.readiness`: Ready / Almost / Needs work; null/absent is Not checked. Empty means any readiness. Reuses `filterLeads`; does not recalculate readiness. |
| Has a verified email | Requires non-null stored readiness and an explicit `readiness_missing` array without `verified_email`, plus at least one nonblank saved primary/additional address or non-dismissed contact address. `evaluateReadiness` writes this assessment only when a saved address matches a successful checker `valid` verdict. Email presence, Apollo reveal flags, Hunter claims, catch-all and suggestions alone never establish verification. |
| Hide leads I can't pick | Excludes rows whose existing classifier result is ineligible, including the existing pending-review exclusion. Off by default. |
| Show only selected | Intersects the displayed rows with the selected ID set; does not change that set or bypass any other filter. |

Filters use AND between categories and OR within each multi-select. Contact dates only filter the list; a due follow-up does not override an eligibility refusal. The existing enrolment loader still prefers an active enrolment over a paused one for the same lead. The local clock refreshes once per minute; changing the run timezone also recomputes the groups and date filters. No date helper or server rule changed.

The verified-email control deliberately says it uses the **last saved Deep find check**. The existing schema stores the assessment, not an address-bound verification timestamp/verdict list. Manual address/contact changes after that assessment can make it stale; this build neither invents fresh verification nor changes the schema to solve that existing limitation. A missing assessment/missing-reasons array fails the filter closed. The optional nested contact projection reads existing RLS-scoped contacts, and excludes dismissed contacts when checking address presence. It performs no verification service calls.

## Reason mapping

All classifier reasons come directly from the unchanged `classifyLead`; pending review comes from the existing draft/failed Autopilot-email set.

| Result | Visible explanation |
|---|---|
| `new` | Ready to pick |
| `due` | Due today or overdue |
| `replied` | Replied |
| `opted_out` | Opted out |
| `blocked` | On the blocklist |
| `closed` | Already won or lost |
| `paused` | Sequence paused |
| `not_due` | Not due yet |
| `recently_contacted` | Contacted today / Contacted 1 day ago / Contacted N days ago; floor of elapsed 24-hour days, clamped to zero |
| `pending_review` | Has an email waiting for review |

Pending-review exclusion retains its previous priority over classifier evaluation. Rendering a reason never changes eligibility. Disabled rows keep readable reason text, rather than relying on colour alone.

## Performance and UI decisions

- Search debounces for 150 ms. Memo dependencies exclude raw search text, so typing does not refilter until the debounce settles.
- Filtering is memoised. With Show only selected off, selection changes do not recompute matching rows. Original row identities are retained; pipeline sections and rows are memoised.
- Each pipeline initially renders 100 matching rows. Show more adds 100. Collapsed sections render no row components. Filtering resets the section's rendering allowance to 100.
- Bulk selection includes every matching eligible result, including matches behind Show more or a collapsed disclosure. Those controls limit rendering, not membership of the filtered result. It excludes leads hidden by actual filters and all disabled rows. The displayed N counts the complete matching eligible result.
- Native pipeline-filter disclosure, labelled checkboxes, reused `MultiSelect`/`SelectField`, real pipeline disclosure buttons with `aria-expanded`/`aria-controls`, focus-visible styles, wrapping text and existing theme tokens. No dependency, CSS token or global dropdown implementation changed.
- Empty pipelines appear in the pipeline filter but not as blank result sections. Loading/error/no-organisation/no-leads/no-matches states are explicit. A lead becoming ineligible does not silently delete its stored selection; the existing submit-time pruning excludes it from the run.

## Files changed

- `src/lib/selectableLeads.ts`, `selectableLeads.test.ts`: retain all classified rows and stable ordering, preserving the existing eligible submit list.
- `src/lib/autopilotPicker.ts`, `autopilotPicker.test.ts`: pure filter/contact/selection/reason logic and 34 cases.
- `src/lib/autopilotPickerUi.test.js`: five real server-rendered component checks, without mocked row components.
- `src/components/autopilot/PickerFilterBar.tsx`, `PickerLeadRow.tsx`, `PickerSelectionBar.tsx`: split controls, accessible disabled rows and sticky selection summary.
- `src/components/autopilot/PipelineSection.tsx`, `SelectedLeadsPicker.tsx`, `SelectedSetup.tsx`: disclosure/pagination, filtering and parent-owned state.
- `src/hooks/useOrgLeads.ts`: opt-in nested saved email contacts; other callers retain their original projection.
- `src/hooks/useSelectableLeads.ts`: opt-in contact projection, complete current-org pipeline filter options and minute clock.
- `src/types/index.ts`: optional nested contact projection type; no database column.
- `src/pages/AutopilotSetup.tsx`: retain visited selected setup across section switches; reset on organisation change.
- `docs/HANDOFF.md`, this report: review/resumption evidence. `AGENTS.md` and `CLAUDE.md` were not changed, as directed by the brief.

All changed components are below 150 lines; the existing setup page is 145 lines.

## TDD and gates

Baseline recorded before implementation. `npm ci --offline --no-audit --no-fund` installed existing locked packages from cache. The first suite had **187 passing files / 2,663 passing tests and one unloadable file**, `src/lib/replyMime.test.js`, due to missing local `npm:imapflow@1` resolution. The existing reply-alerts report documents its ignored scratch bootstrap. Ran that bootstrap offline, with scripts disabled, for existing PostalMime/ImapFlow edge dependencies; no root manifest or lockfile changed. The clean baseline then matched the brief: **188 files / 2,664 tests**. Baseline TypeScript, build and whitespace checks passed.

Tests preceded implementation: two retained-row assertions failed against the old grouping; the new pure-module tests initially failed because the module did not exist; four component assertions failed for absent controls/disabled rows/filter hints/render limiting while the loading/error case already passed. Targeted tests went green after implementation. The final suite adds **two files / 41 tests**: 34 pure filter cases, five component cases and two grouping cases. Fixtures exercise real shared classification and filtering; they send no mail and use no database or service.

| Final gate at application revision `0ef96a2` | Result |
|---|---|
| `npx tsc --noEmit` | PASS, zero diagnostics |
| `npx vitest run` | PASS, **190 files / 2,705 tests / zero failures** |
| `npm run build` | PASS, **2,925 modules**; existing >500 kB chunk warning remains |
| `git diff --check` | PASS |
| `git diff ac3f979..HEAD --check` | PASS |

Only dummy local environment values were used: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. npm reported blocked esbuild/workerd install scripts; build and tests passed without approving or running them. Gate logs remain ignored local `*.log` files. Subscription usage is not exposed; no percentage or paid fallback is claimed.

## Unverified and rollout

Not verified: browser interaction, keyboard/focus or screen reader behaviour, phone-width overflow, visual contrast/layout in either theme, real browser rendering performance with hundreds of leads, interactive section-state persistence, live nested-contact/RLS reads, concurrent changes or a real start of a run containing cross-pipeline selections. Server-rendered tests verify emitted controls/reasons and a 240-lead render cap; they do not establish those browser or live guarantees. The existing loader's fetched enrolment/blocklist/pending-review snapshots are not a new realtime subscription; the server remains authoritative at start/run time.

**Deploy list: frontend only.** No database change, migration, audit, edge function, engine, cap, review-before-send rule, RLS or grant change was needed or made. No external service call, real credential, mail/message, remote write, push, merge or deployment occurred. No other checkout was edited. Hooks/vault sync stayed off to respect the new-worktree-only boundary. No background job remains.

Stop here. Claude reviews this branch, especially saved-assessment semantics, filtered bulk selection and section persistence, before any separately authorised merge or publication.
