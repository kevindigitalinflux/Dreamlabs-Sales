# Build brief: Autopilot "selected leads" picker, search, filters and cross-pipeline selection

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs and approved this scope on 2026-10-29.

Work only in a NEW worktree you create: `git worktree add ../dreamlabs-sales-picker -b codex/autopilot-picker origin/main` from `C:/Users/kevin/Projects/dreamlabs-sales-ux` (run `npm ci` in it). Use `C:/Users/kevin/Projects/dreamlabs-sales-picker` for all work. Do not touch any other checkout.

## Read first
`CLAUDE.md`, `AGENTS.md`, then: `src/components/autopilot/SelectedLeadsPicker.tsx`, `PipelineSection.tsx`, `SelectedSetup.tsx`, `src/hooks/useSelectableLeads.ts`, `src/lib/selectableLeads.ts`, `supabase/functions/_shared/autopilotEligibility.ts` (`classifyLead`, the eligibility reasons), `supabase/functions/_shared/leadReadiness.ts`, and how `src/lib/leadFilters.ts` and the Pipeline list filters work (reuse their wording and patterns, do not duplicate logic).

## Today
The picker is a plain list grouped by pipeline. It only offers leads that are eligible today. There is no search and no filtering. The engine re-checks eligibility server-side when the run starts, and that must stay the source of truth.

## What to build

### 1. Search and filters (combinable, all client-side over the leads already loaded)
- Search box: business name, email, owner name (not city). Case-insensitive, trims, ignores extra spaces.
- Pipeline filter: checkboxes for each pipeline the user can see (all selected by default), with an "All pipelines" shortcut.
- Contact status filter (single choice): Any / Never contacted / Contacted before / Due today or overdue / Not due yet. Define each from existing fields (`last_contacted_at`, active enrolment `next_send_at` against the end of today in the run timezone, lead `next_action_date` if that is what the pipeline uses for "due"). Reuse the same meaning the app already uses for "due today"; record exactly which fields you used in the report.
- Stage filter (multi-select, reuse the stage list and labels).
- Readiness filter (multi-select: Ready / Almost / Needs work / Not checked), using the stored `leads.readiness`.
- "Has a verified email" toggle. Use the existing definition of a verified email (see the readiness rule module and contact data); do not invent a looser one.
- A "Clear filters" button and a one-line summary of active filters ("Showing 34 of 212 leads").
- Filters and search persist while the user changes selection, and survive switching between this screen's sections, but need not persist across page loads.

### 2. Cross-pipeline selection
- Selection is one set of lead ids that spans all pipelines, regardless of filters. Changing a filter never removes anything already selected.
- Add "Select all matching (N)" and "Clear selection". Select all matching selects only leads that are currently visible AND eligible; it must never select hidden leads or ineligible ones.
- Per-pipeline "select all in this pipeline" respects the same rule. Keep each pipeline section collapsible (reuse the same disclosure pattern as the run screen: real button, `aria-expanded`, `aria-controls`).
- A sticky or always-visible selected counter: "12 selected in 3 pipelines" with a "Show only selected" toggle. Show a hint when selected leads are hidden by a filter ("3 selected leads are hidden by your filters").

### 3. Show ineligible leads greyed out with the reason
- Ineligible leads are listed but disabled (checkbox disabled, row visually muted) with the reason in plain words next to them: for example "Contacted 3 days ago", "Replied", "Opted out", "On the blocklist", "Already won or lost", "Not due yet", "Has an email waiting for review". Take the reason from `classifyLead` and the existing derived sets; map each to a short plain sentence. Do not rely on greying alone: the reason text must be present and exposed to assistive tech (`aria-describedby` or visible text in the row).
- A toggle "Hide leads I can't pick" (off by default).
- The default sort: eligible first, then by business name; keep a stable order while selecting.
- The engine's own eligibility check at start/run time is unchanged and remains authoritative.

### 4. Quality
- Works with hundreds of leads without lag: memoise filtering, do not re-render every row on each keystroke (debounce the search, about 150 ms), and cap the initial render sensibly (for example render the first 100 matches of a section with a "Show more" button) if needed. Record what you did.
- Keyboard accessible, labelled controls, focus-visible, phone width, both themes. Plain, short UK English. Loading, empty ("No leads match these filters") and error states.
- Keep components under about 150 lines: split into FilterBar, LeadRow, SelectionBar, etc.

## Constraints
- TDD: failing test first for the pure logic (filtering, selection rules, reason mapping, contact-status definitions); keep them in a pure module with tests.
- No database change, no migration, no new edge function. If you believe one is needed, stop that item and record it.
- No change to eligibility rules, the engine, caps, review-before-send, RLS or grants.
- Do not call any external service. Do not push, merge, deploy, apply migrations, or write to any remote or Supabase. No real credentials, mail or messages.
- Dummy env for local runs: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. No new dependencies.
- Stage explicit paths only. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.
- Do not add a new checkpoint block at the top of `AGENTS.md`, `CLAUDE.md` or `docs/HANDOFF.md`; add one short dated section in `docs/HANDOFF.md` only.

## Gates
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`. Record the baseline first (expected 188 files / 2,664 tests) and report exact counts.

## Deliver
`docs/AUTOPILOT-PICKER-BUILD-REPORT.md`: what was built, files changed, the exact definitions used for each filter (especially "due today", "contacted before", "verified email"), the reason mapping table, performance decisions, gate results, decisions where the brief was silent, and what was not verified (browser, phone width, themes, keyboard, a real start of a run with a cross-pipeline selection). No edge function or migration should be needed; state the deploy list (expected: frontend only). Then stop. Claude reviews before any merge.
