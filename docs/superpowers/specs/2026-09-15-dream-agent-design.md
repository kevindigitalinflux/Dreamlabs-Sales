# Dream Agent — Design Spec

## Overview

**Dream Agent** is a new, top-level page where a user can hand the AI a free-form
account of their sales session (typed or voice-transcribed) and have it propose
updates across every lead the note touches — not just one lead at a time, which is
all today's existing `parse-notes` AI layer can do. It also owns the CSV-upload path:
turn a spreadsheet into reviewable candidate leads. Both paths funnel through the same
non-negotiable guardrail already proven in this app (`SuggestionDiff`): **the AI never
writes anything without an explicit confirm.**

This spec also covers two small additions to existing pages that share Dream Agent's
CSV machinery and extend its "which pipeline?" question to their own flows: Pipeline
Manage's pipeline-creation options, and the Scraper's pre-scrape pipeline choice.

This is piece 4 of the user's original 5-part request (multi-pipeline support,
piece 3, shipped 2026-09-15). Piece 5 — autopilot's own "existing pipeline vs. new
scrape" choice — is explicitly **out of scope** here; it touches the cron-driven
`run-autopilot` system and its budget/volume caps, a different subsystem, and stays
its own follow-up plan per the user's own direction.

## Notes Flow

**New page:** `src/pages/DreamAgent.tsx`, route `/dream-agent`, a new Sidebar nav
item (own top-level entry, not nested under Pipeline or anywhere else).

**Layout:** a scrolling transcript area (your notes and the AI's proposals, in
submission order — a normal page, not chat bubbles) with the input fixed at the
bottom: a textarea, a microphone button, and a "Match against" selector defaulting to
whichever pipeline is currently active in the top-bar switcher, changeable to any
other pipeline you can see or to "Whole platform."

**Voice input:** the browser's `SpeechRecognition` API transcribes live into the
textarea. No new backend, no per-use cost — it's purely a client-side input method
feeding the same text pipeline as typing. Where unsupported, the mic button is hidden
with a brief note; typing always works.

**The hybrid submit/refine loop:** every submission — the first note, or a free-text
follow-up — sends the *entire* conversation so far (original note + every follow-up)
to a new edge function, `parse-session-notes`, along with a lightweight lead index
(id, business_name, city, stage) scoped to the "Match against" selection — either one
pipeline's leads, or, for "Whole platform," every lead in every pipeline the caller
can see **within their currently-selected org**. "Whole platform" deliberately does
NOT span a pipeline shared in from a *different* org (even one the caller has full
edit/fork access to) — mixing leads across genuinely different businesses into one
match call is a correctness and privacy risk this spec doesn't need to take on;
someone working a cross-org shared pipeline switches their active org to it first
(the pipeline switcher already supports this), or matches against it specifically via
the "one pipeline" option. It returns a fresh, complete list of proposed actions:

- **`update`** — matched an existing lead with reasonable confidence: `lead_id` + a
  field patch (identical shape to today's `LeadSuggestion` — `stage`, `deal_value`,
  `package_tier`, `next_action_date`, `next_action_note`, `pain_point`, `rationale`) +
  the note's relevant excerpt.
- **`create`** — mentioned someone not in the lead index at all: extracted fields
  (whatever was mentioned — business name, phone, email, etc.) + rationale. If the
  "Match against" selection was a specific pipeline, this action already carries that
  pipeline as its target and needs no further input; if it was "Whole platform," the
  row needs a pipeline picker resolved before it can be confirmed.
- **`ambiguous`** — could match 2+ leads, or a mention too vague to resolve alone: a
  short list of candidate lead ids + the mentioned text.

**Review UI:** one row per action, rendered in the transcript as the AI's response to
your note. `update` rows render as today's `SuggestionDiff` (from → to, per-field,
Apply/Dismiss). `create` rows show the extracted fields plus (if needed) the pipeline
picker. `ambiguous` rows show a small picker: choose one of the candidates, mark "this
is someone new" (promotes it to a `create` row), or "skip this one." At this point you
have two ways to proceed:

1. **Resolve the rows directly** and confirm — applies every resolved `update`
   (via the existing `applyLeadUpdate`, which already auto-logs stage changes) and
   `create` action, and logs an `ai_summary`-type `lead_notes` row on each affected
   lead capturing the relevant excerpt and rationale — the same audit-trail pattern
   this app already uses for AI-authored notes elsewhere.
2. **Or reply in free text** with a correction or clarification — the AI reads it in
   context and re-proposes a fresh, complete action list, which you resolve the same
   way. Any number of refinement rounds can happen; nothing is ever written to the
   database until rows are explicitly confirmed, no matter how the conversation goes.

Dismissed or never-confirmed portions of a note are simply discarded when you leave
the page or start a new note — nothing is logged for anything that wasn't applied.

## CSV Flow

CSV uploads reuse the app's existing "produce a batch of candidate leads, review them,
flag duplicates, approve into a pipeline" machinery — the `scrape_jobs`/`raw_leads`
tables and the `ScraperJob` review page — rather than a second, parallel
implementation. No schema migration is needed for this: `raw_leads.source` is a plain
`TEXT` column with no `CHECK` constraint, so a new value needs only a TypeScript type
change (`ScrapeSource` widens to include `'csv_upload'`).

**Flow:**
1. **Pipeline first**: pick an existing pipeline or name a new one — resolved before
   any parsing happens, matching the original request exactly.
2. **File picked, parsed client-side** by a new `parseCsv` utility (proper
   quoted-field handling, RFC-4180-symmetric with the existing `toCsv` export helper,
   unit-tested) into headers + rows.
3. A new edge function, `parse-csv-leads`, receives the headers, a representative
   sample of rows, and every existing lead in the target pipeline's *org* (for
   duplicate detection — org-wide, not just the target pipeline, matching the
   existing scraper's own precedent so a CSV import can't create a duplicate of a
   lead that already exists in a different pipeline). It maps columns to lead fields
   (whatever's recognizable — business name, phone, email, website, city, etc.), and
   for every row: checks it against the existing-leads list using the same
   business-name+city-or-email match the scraper already uses, creates one
   `scrape_jobs` row (`sources: ['csv_upload']`,
   `icp_raw_input`/`icp_params` left `NULL` — both nullable today, no CSV-specific ICP
   exists), and bulk-inserts every row into `raw_leads` (`source: 'csv_upload'`,
   `status: 'duplicate'` for flagged rows, `'pending'` otherwise).
4. **Redirects to the existing `ScraperJob` review page** for that job — same
   duplicate flags, same pipeline picker (Task 10) already built there.
5. **New addition to that page**: a "select all" + "Approve selected" bulk action —
   the one genuinely new piece of UI this flow needs, since today's page only
   supports approving one row at a time. Individual rows (especially
   duplicate-flagged ones) can still be reviewed and approved/rejected/skipped one at
   a time as they already can.

## Shared Entry Points

**Dream Agent's own page** gets a second mode/tab for the CSV flow above, alongside
the notes flow.

**Pipeline Manage's "Create pipeline"** gains a choice of how to start it:
- **Manual** — today's existing empty-pipeline flow, unchanged.
- **CSV upload** — opens the exact same flow described above, just launched from
  here; one implementation, a second entry point.
- **Scrape** — hands off to the Scraper page with "new pipeline" pre-selected.

**The Scraper page's ICP-setup step** gains its own pipeline choice — new pipeline
(named right there) or an existing one (picker) — resolved before the scrape runs,
mirroring the choice already on the *approval* step (Task 10) but set once up front
rather than re-asked per approved lead.

## Non-Goals

- Autopilot's "existing pipeline vs. new scrape" choice (piece 5 of the original
  request) — stays its own separate follow-up plan.
- Persisting Dream Agent conversation transcripts beyond the current page session —
  only confirmed, applied actions leave a permanent trace (as an `ai_summary` lead
  note); the conversation itself is ephemeral client-side state.
- Auto-logging a note on CSV-imported leads — matches the existing scraper-approval
  precedent, which doesn't auto-note either.
- Audio-based transcription (recording + a paid transcription service) — browser
  `SpeechRecognition` only, per the explicit choice to avoid new infrastructure and
  per-use cost for what's just an input method.
- Any change to the RLS/pipeline access model itself — Dream Agent and the CSV flow
  operate entirely within the access rules multi-pipeline support already
  established (a lead index sent to `parse-session-notes` only ever includes leads
  the caller can already see; a CSV import can only target a pipeline the caller can
  already edit).
