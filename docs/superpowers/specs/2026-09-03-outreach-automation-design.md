# Outreach Automation — Design Spec

## Context

Kevin can't sustain manually sending outreach at volume. This spec covers three outreach
channels — cold email, warm LinkedIn DM, and a Mr Brush JV/partnership channel — automated end
to end except for the one step LinkedIn's terms require a human to do (the actual send).

This supersedes the original handoff doc (`C:\Users\kevin\Downloads\dreamlabs-sales-outreach-spec.md`),
which assumed an n8n execution engine and a standalone Apollo-sourced prospect list. Both
assumptions are now stale: this app already runs all of its automation natively (Supabase edge
functions + cron — no n8n dependency anywhere in this repo), and cycle 4 already built a full
lead-discovery-and-approval pipeline (`leads` table, populated via the scraper's review flow).
Reusing what's already built where it fits is the design principle throughout this spec — the
original doc's copy (templates, subject lines, sequence timing) is still the source of truth for
content and is carried forward unchanged.

## Decisions Locked (from brainstorming)

| Decision | Choice |
|---|---|
| Execution engine | Native — Supabase edge functions + cron, extending what cycle 2/4 already built. No n8n. |
| Prospect source (cold email + JV) | The existing `leads` table — leads already approved into the pipeline via the scraper's review flow. No separate/unreviewed prospecting mechanism. |
| Cold email + JV pitch infrastructure | Extend the existing sequence engine (`email_templates`/`email_sequences`/`sequence_enrollments`/`check-sequences`) — new templates + sequences, not new tables or a new cron. |
| LinkedIn DM infrastructure | New — no sequence/cron fit (sending itself can't be automated). New table + edge function + queue UI, reusing the existing review-queue *pattern* only. |
| Outreach AI model | Claude, not Gemini (Gemini stays for internal/background AI — ICP parsing, note parsing, unchanged). **Notes-then-draft architecture** (refined after initial design): Sonnet never writes a full cold-email/JV-pitch body directly — it generates a short, reusable set of personalization notes for a lead once, cheaply (small output); Haiku always writes the actual email, using whatever notes exist as context. LinkedIn DM always uses Sonnet directly for the message itself (no notes-step — a one-off DM doesn't benefit from splitting notes from copy the way a 3-touch sequence does). Reply drafting: Haiku classifies a reply simple/complex first (cheap), then Haiku drafts if simple or Sonnet drafts directly if complex. |
| Reply detection | Built in, not deferred — IMAP polling (`npm:imapflow`) against each contractor's own verified mailbox, matching replies to sent emails via the `In-Reply-To`/`References` headers against a stored `Message-ID`. Auto-pauses the enrollment on match. Whether a detected reply also gets an AI-drafted suggested response is a **per-sequence toggle** (`email_sequences.auto_draft_on_reply`), not one fixed behavior. When it does draft, the model is chosen by reply complexity (see AI model row above), not the lead's priority/notes status. |
| Anthropic API cost model | BYO-per-org, matching the existing pattern — but specifically the *Gemini/Places/Companies-House* variant of that pattern (global fallback available), not the Apollo/Hunter variant (never falls back). Mr Brush & Co and DI Dreamlabs (`use_global_api_fallback=true`) fall back to Kevin's global `ANTHROPIC_API_KEY` if they haven't configured their own; UX Tree and DI Academy must configure their own key before any outreach channel activates for them, same as every other paid provider today. **Flagging this interpretation explicitly for review** — the brainstorming answer was "BYO-per-org, matching existing pattern," and this repo's "existing pattern" is genuinely two-tier (Gemini/Places/CH have a fallback for Kevin's orgs; Apollo/Hunter never do) — this spec picks the Gemini-style tier since Anthropic costs are Gemini-scale trivial, not Apollo/Hunter-scale meaningful. Say so if the no-fallback-ever variant was actually intended. |
| Auto-enrollment trigger | A lead newly approved into the pipeline (`stage = 'new_lead'`) with no existing active/paused `sequence_enrollments` row gets auto-enrolled into its org's default cold-outreach sequence. The schema already enforces max one active/paused enrollment per lead, so this can't conflict with a manual enrollment — a contractor manually enrolling a lead into a different sequence simply supersedes the automated one (same `enroll()` call already in `useEnrollments.ts`, no new conflict-handling needed). |
| JV pitch scope | Mr Brush & Co only, matching the original doc — the audience (local commercial real-estate/facilities contacts) isn't sourced via the scraper's ICP flow (different business type from cleaning-service prospects), so JV contacts are added manually, not auto-enrolled. |
| Rollout order | Mr Brush & Co + DI Dreamlabs first (Kevin's own two orgs). UX Tree / DI Academy's sequence copy, ICP, and channel mix still need a session with Valentina/Suj respectively before their workspaces go live — unchanged from the original doc, not part of this build. |
| AI-tell punctuation guardrail | Every AI-drafted email this app sends (outreach *and* the existing cycle-2 follow-up drafts) gets a deterministic post-processing pass replacing em-dashes/spaced-hyphens with commas, plus a prompt instruction to avoid the pattern in the first place. Applies regardless of model (Gemini or Claude). |
| Autopilot mode | A user-configurable, cron-driven campaign: fixed duration (1 day / 1 week / 2 weeks / 3 weeks / 1 month), a daily lead-scrape target and a daily cold-outreach-send target (independent dials), a cost estimate shown before confirming, and a live-progress view with a manual stop control while it runs. Scraped leads are **auto-approved** straight into the outreach pipeline while autopilot is active (no human review step) — the whole point is hands-off operation. ICP is described fresh at setup (reusing the existing AI-parse step), not picked from a saved list. |

---

## 1. Cold Email + JV Pitch — extending the sequence engine

### 1a. New content (no schema change)

Two new `email_templates` rows per org-relevant channel, `is_default = true`:
- `template_type: 'cold_outreach_1' | 'cold_outreach_2' | 'cold_outreach_3'` — the three-touch
  "reveal-a-problem" copy from the original doc §2, `org_id` scoped to Mr Brush & Co and DI
  Dreamlabs at launch.
- `template_type: 'jv_pitch_1' | 'jv_pitch_2'` — the original doc §4 copy, `org_id` scoped to Mr
  Brush & Co only.

Two new `email_sequences` rows (`steps: Step[]`, matching the existing `{delay_days,
template_type, subject_override}` shape):
- `cold_outreach_default` — `[{delay_days: 0, template_type: 'cold_outreach_1'}, {delay_days: 3,
  template_type: 'cold_outreach_2'}, {delay_days: 7, template_type: 'cold_outreach_3'}]`, one row
  per org (Mr Brush, DI Dreamlabs), each org's row is what auto-enrollment targets.
- `jv_pitch_default` — `[{delay_days: 0, template_type: 'jv_pitch_1'}, {delay_days: 5,
  template_type: 'jv_pitch_2'}]`, Mr Brush only. Not auto-enrolled (see JV pitch scope above) —
  enrolled manually via the existing `useEnrollments` flow on a JV contact's lead-style record.

### 1b. Auto-enrollment (new)

New edge function `auto-enroll-cold-outreach`, cron-triggered (same `x-cron-secret` pattern as
`check-sequences`, same schedule — piggyback on the existing daily cron rather than adding a
second one):

```
For each org with a cold_outreach_default sequence configured:
  SELECT leads WHERE org_id = <org> AND stage = 'new_lead'
    AND id NOT IN (SELECT lead_id FROM sequence_enrollments WHERE status IN ('active','paused'))
  For each: enroll(lead.id, cold_outreach_default.id) — same insert shape as useEnrollments.enroll(),
    enrolled_by = null (system-enrolled, distinguishable from a contractor's manual enrollment)
```

`enrolled_by = null` is a deliberate, visible signal in the UI (the existing lead-detail
enrollment view can show "Auto-enrolled" instead of a contractor's name when this is null) — no
schema change needed, `enrolled_by` is already nullable.

### 1c. Manual priority flag (new column)

`leads` gains `is_priority boolean NOT NULL DEFAULT false` — a plain toggle on the lead detail
page (any contractor or admin can set it; it's a triage signal, not a permission). No new table:
this is the same tier of change as `is_priority` on any other CRM lead flag.

### 1d. AI routing — notes-then-draft (extends `_shared/ai.ts` + `check-sequences`)

Refined from the first draft of this spec after feedback: **Sonnet never writes a full cold-email
or JV-pitch body directly.** It writes a short, cheap, *reusable* set of personalization notes for
a qualifying lead, once. Haiku always writes the actual email — subject and body, every touch, every
lead — using whatever notes exist (Sonnet-generated or a contractor's own) as context. This keeps
Sonnet's cost to its short analysis output only (the expensive part of an LLM call), while every
send still benefits from Sonnet-quality thinking rather than only some sends getting the full
Sonnet treatment and the rest getting none.

`_shared/ai.ts` gains two Claude-backed functions:
- `generateLeadNotes(input: {lead, icpParams, apiKey}): Promise<string>` — Sonnet only. Given the
  lead's data and the ICP it was scraped against, produces 2-4 short bullet-style personalization
  talking points (e.g. a likely pain point implied by review count/rating, a plausible angle from
  its industry/location). Throws on failure, same contract as `draftEmail`.
- A Claude-backed sibling to `draftEmail`, same signature/contract as the existing Gemini one,
  hitting `https://api.anthropic.com/v1/messages`. Model name (`claude-sonnet-5` /
  `claude-haiku-4-5`) is a parameter on this one shared function, not two near-duplicate functions.

**"Compatible lead" gate** — decides whether a lead gets a Sonnet notes pass at all:
`lead.is_priority` **OR** `tight_icp_fit` (see below) **OR** a human-authored `lead_notes` row
already exists for it (`note_type != 'ai_summary'` — deliberately excludes AI-generated notes from
this check, so an earlier Sonnet pass doesn't make itself look like a second qualifying signal).
Any one of the three is enough.

`tight_icp_fit` — a plain boolean computed at drafting time by joining
`leads.raw_lead_id → raw_leads.scrape_job_id → scrape_jobs.icp_params` (no new column; `icp_params`
already exists on `scrape_jobs`, this just reads it): the lead's `google_rating` falls inside
`[icp_params.min_rating, icp_params.max_rating]`, its `review_count` is at or under
`icp_params.max_reviews`, and its `vertical` case-insensitively matches `icp_params.industry` —
all three, not any one. **Flagging this rule for review** — it's a concrete, buildable first pass
using only fields this app already scores against, not a fully-general lead-scoring system; revisit
if it under- or over-qualifies leads in practice once real volume runs through it.

**`check-sequences` changes**, for `cold_outreach_*`/`jv_pitch_*` template types only (every other
template type's existing Gemini path is completely untouched):
1. `resolveOrgApiKey(service, orgId, 'anthropic')` — if no key resolves, skip drafting for that
   enrollment this run (same `skipped.push(...)` pattern already used for missing templates/leads)
   rather than falling back to Gemini — outreach content must never silently degrade to the wrong
   model's voice.
2. If the lead has no `ai_summary` `lead_notes` row yet **and** the compatible-lead gate passes:
   call `generateLeadNotes()` (Sonnet), insert the result as a `lead_notes` row
   (`note_type: 'ai_summary'`, `created_by: null` — same null-means-system-generated convention as
   `enrolled_by`/auto-approved leads). This happens once per lead's lifetime, not once per touch —
   the note persists and is naturally reused (and visible to a human, on the lead's detail page)
   for every subsequent touch in the sequence, so touch 2/3's drafting doesn't pay for a second
   Sonnet call on the same lead. JV pitch always gets a notes pass on its first touch too (JV
   contacts aren't ICP-scraped so `tight_icp_fit` doesn't apply there — the gate simplifies to
   "always" for this channel, since its whole audience is manually curated and low-volume).
3. Draft the actual subject/body with **Haiku**, always, passing along any existing `lead_notes`
   (human or `ai_summary`) as context — exactly the same call shape `draftEmail` already uses for
   Gemini, just Haiku instead.

Everything downstream is unchanged: the result still lands in `email_logs` as a `status: 'draft'`
row in the existing review queue (`useDrafts`, `EmailReviewQueue.tsx`) — a contractor/Kevin reviews
and sends through the existing `send-email` path. No new send infrastructure, no new UI for these
two channels' approval step.

### 1e. Reply detection (new — built in, not deferred)

**Data model additions:**
- `user_email_settings` gains `imap_host text` / `imap_port integer` — auto-derived and hidden
  from the settings UI for `gmail`/`outlook`/`yahoo` (`imap.gmail.com:993`,
  `outlook.office365.com:993`, `imap.mail.yahoo.com:993`), required manual input for the generic
  `smtp` provider (mirroring how `smtp_host`/`smtp_port` already work for that provider today).
  Reuses the same Vault-stored password already collected for SMTP send — every provider this app
  supports uses one app-password/credential for both SMTP and IMAP, so no second credential
  collection step.
- `email_logs` gains `message_id text` — the `Message-ID` header of the sent email, captured and
  stored by `send-email` at send time (denomailer's send result exposes this; if the specific
  version in use doesn't, generate and set the header explicitly before sending so it's always
  known). This is what makes reply-matching precise instead of a fuzzy same-sender-address guess.
- `email_sequences` gains `auto_draft_on_reply boolean NOT NULL DEFAULT false`. The two new
  sequences this build adds (`cold_outreach_default`, `jv_pitch_default`) are created with this set
  `true`; every pre-existing cycle-2 sequence keeps the column's default `false`, so no existing
  sequence's behavior changes.

**New edge function `check-replies`**, cron-triggered on the same schedule as `check-sequences`
(a second function on the same cron event, not a second cron job):
1. For each user with `user_email_settings.is_verified = true`: connect via `npm:imapflow` using
   their stored IMAP host/port + Vault credential.
2. List inbox messages received since this user's last check (a new
   `user_email_settings.last_imap_check_at timestamptz` tracks the watermark).
3. For each message, check its `In-Reply-To`/`References` headers against `email_logs` rows with
   `status = 'sent'` and a `message_id` — a match identifies exactly which sent email this is a
   reply to, and therefore which `lead_id`/`sequence_enrollment_id`.
4. On a match: pause the enrollment (`sequence_enrollments.status = 'paused'`, same transition
   `useEnrollments.setStatus` already performs) and insert an `email_replies` row (new table:
   `email_log_id`, `lead_id`, `org_id`, `from_email`, `subject`, `body`, `received_at`) — this
   becomes the reply's permanent record, surfaced on the lead detail page alongside `lead_notes`.
5. If the paused enrollment's `email_sequences.auto_draft_on_reply` is `true`, draft a suggested
   response in two steps — replies get their own routing logic, distinct from §1d's notes-then-draft
   split, since a reply is a one-off judgment call about *this specific message*, not a repeatable
   personalization pass:
   a. **Classify** — a cheap Haiku call reads the reply and labels it `simple` (a short
      acknowledgment, a plain yes/no, an out-of-office) or `complex` (a real question, an
      objection, multiple points raised, anything that needs actual judgment to respond to well).
      Minimal output (one word), so this classification step itself is nearly free.
   b. **Draft** — `complex` replies get a full Sonnet drafting pass (Sonnet writes the response
      directly here, not just notes — the reply itself already supplies the personalization
      context §1d's notes step exists to manufacture for a cold lead). `simple` replies get Haiku,
      using the same lead-notes context as any other draft.
   Either way, the result is inserted into `email_logs` as a normal `status: 'draft'` row — it
   lands in the existing review queue exactly like any other draft. Never auto-sent, matching every
   other AI-drafted message in this app.
6. If `auto_draft_on_reply` is `false`: no draft is created — the paused enrollment and the new
   `email_replies` row are the only signal, surfaced as a "needs your attention" item (dashboard
   addition, detail TBD in the implementation plan).

This applies to cold email and JV pitch (both run through `sequence_enrollments`); LinkedIn's reply
handling stays manual, per §2d — there's no inbox to poll for a DM sent outside this app.

### 1f. AI-tell punctuation guardrail (new — applies to every AI-drafted email, not just outreach)

Dash-heavy prose (em-dashes, spaced hyphens used as clause connectors) is now a widely-recognized
"this was written by AI" signal, which is a real deliverability/credibility risk for cold outreach
specifically and worth fixing everywhere this app drafts email content, including the existing
cycle-2 Gemini-drafted follow-ups.

Two layers, since a prompt instruction alone isn't a guardrail (models don't reliably follow style
instructions under all conditions):
1. **Prompt-level**: every drafting prompt (`draftEmail` for Gemini, its new Claude sibling, the
   LinkedIn drafter, and the reply auto-drafter) gets an explicit line: *"Never use em-dashes or
   hyphens as sentence punctuation — use commas or periods instead."*
2. **Deterministic post-processing**: a new shared function `_shared/textGuardrails.ts` →
   `stripAiPunctuation(text: string): string`, applied to every draft's subject **and** body right
   before it's stored (in `check-sequences`, `check-replies`'s auto-draft path, and
   `draft-linkedin-message`), replacing `" — "` / `" – "` / `" - "` (space-dash-space, any dash
   variant) with `", "`. This is a blunt, reliable regex pass, not an AI call — it guarantees the
   rule holds even when the model ignores the prompt instruction.

---

## 2. LinkedIn DM — new, minimal build

### 2a. Data model (new migration)

```sql
CREATE TABLE linkedin_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  full_name text NOT NULL,
  linkedin_url text,
  context_signal text,        -- free text: "recent achievement", "job change", etc. — manually noted on import
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','drafted','approved','sent','skipped')),
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE linkedin_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES linkedin_contacts(id),
  org_id uuid NOT NULL REFERENCES organizations(id),
  message text NOT NULL,
  template_variant text NOT NULL CHECK (template_variant IN ('achievement','life_update','general')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','skipped')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: org-scoped, matching every other cycle-3/4 table exactly (is_org_member(org_id) read,
-- is_org_admin(org_id) or the creating contractor for writes — same pattern as scrape_jobs/raw_leads).
```

Contacts are added manually (a simple form: name, LinkedIn URL, optional context signal) — no
scraper integration, matching the original doc's "warm list export" framing (these are existing
connections, not discovered prospects).

### 2b. Drafting

New edge function `draft-linkedin-message`: given a `contact_id`, picks the ACA template variant
based on whether `context_signal` is populated (`achievement`/`life_update` if present,
`general` if not — same non-generic-vs-generic logic as cold email, applied to the data that's
actually available for this channel), calls the same shared Claude function as above (always
Sonnet, per the locked decision), inserts a `linkedin_drafts` row. Triggered manually per-contact
or in a small batch from the queue UI — no cron, since there's no "due date" concept for a DM the
way there is for a sequence step.

### 2c. Queue UI

New page at `/outreach/linkedin`, reusing
`EmailReviewQueue.tsx`'s visual pattern: one row per draft, message text, three actions —
**Approve** (status → `approved`, message becomes copy-pasteable + an "Open LinkedIn profile"
link), **Edit** (inline textarea before approving), **Skip** (status → `skipped`, contact stays
available for a future draft attempt). Once approved, a **Mark as sent** action sets
`status: 'sent'` on both the draft and its contact — this is the one manual step LinkedIn's terms
require, and the UI should make it feel like the final click of a completed flow, not a
half-finished automation.

### 2d. Reply handling

Fully manual, per the original doc — no LinkedIn inbox API exists to poll. `linkedin_contacts`
has no reply-status field; if this becomes worth tracking later, add it then rather than building
speculative fields now.

---

## 3. Autopilot Mode — new, cron-driven, fully hands-off

A user-triggered campaign that runs the scrape → approve → enroll → draft → send loop
unattended for a fixed window, at a rate the user sets in advance, with an upfront cost estimate
and a live progress view. One active autopilot run per org at a time.

### 3a. Data model (new migration)

```sql
CREATE TABLE autopilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  icp_raw_input text NOT NULL,
  icp_params jsonb NOT NULL,
  source text NOT NULL CHECK (source IN ('google_places','companies_house')),
  daily_lead_target integer NOT NULL CHECK (daily_lead_target BETWEEN 1 AND 60),
  daily_outreach_target integer NOT NULL CHECK (daily_outreach_target BETWEEN 1 AND 100),
  duration_days integer NOT NULL CHECK (duration_days IN (1, 7, 14, 21, 30)),
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,                 -- started_at + duration_days, computed at insert
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  estimated_cost_low_cents integer NOT NULL,     -- shown at setup, kept for reference
  estimated_cost_high_cents integer NOT NULL,
  leads_scraped_total integer NOT NULL DEFAULT 0,
  outreach_sent_total integer NOT NULL DEFAULT 0,
  actual_ai_cost_cents integer NOT NULL DEFAULT 0,  -- running total, computed from real draft counts
  created_at timestamptz NOT NULL DEFAULT now()
);
-- RLS: org-scoped, same pattern as scrape_jobs (is_org_member read, is_org_admin or the
-- creating contractor for writes). Partial unique index enforces one active run per org:
CREATE UNIQUE INDEX autopilot_runs_one_active_per_org
  ON autopilot_runs(org_id) WHERE status = 'active';

CREATE TABLE outreach_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  value text NOT NULL,              -- an email address or a bare domain (e.g. "acme.com")
  reason text,                      -- optional free-text note (e.g. "past client", "complained")
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, value)
);
-- RLS: org-scoped, same pattern as everything else in this spec.
```

`source` is single-select, matching the scraper wizard's existing one-source-per-job constraint —
autopilot doesn't introduce a new multi-source capability the backend doesn't otherwise support.
`autopilot_runs` also gains two guardrail columns used by §3e below —
`max_total_spend_cents integer` (nullable — no cap if unset) and `ramp_up_enabled boolean NOT NULL
DEFAULT true`.

### 3b. Setup flow

New page, e.g. `/outreach/autopilot/new`: ICP description (same textarea + `parse-icp` AI-parse
step as the manual scraper wizard, not a separate concept), source picker (same gating logic as
the wizard — disabled/hint if the org's key isn't configured, Companies House disabled for
non-GB), duration (5 fixed options, not freeform), two numeric inputs (daily lead target, daily
outreach target — independent, no cross-validation between them; the outreach dial draws from the
whole pipeline, not just today's scrape), an optional total-spend-cap input, and the ramp-up
toggle (on by default — see §3e). As soon as the numbers + duration are set, a **live cost
estimate** renders: `daily_outreach_target × duration_days` drafts, priced as a range between
all-Haiku and all-Sonnet (Claude drafting is the only real variable cost here — Google
Places/Companies House usage stays within their own free-tier/quota structure and isn't estimated
as a line item, since this app doesn't have visibility into an org's broader Google Cloud/CH
billing). Example copy: *"Estimated Claude API cost for this run: $4–$9, billed to your own
Anthropic key."* If `daily_outreach_target > 30`, an explicit, non-blocking warning renders above
the confirm button (see §3e) — the user can still proceed, but has to see it first. Confirming
creates the `autopilot_runs` row.

### 3c. Daily execution — new edge function `run-autopilot`

Cron-triggered on the same daily schedule as `check-sequences`/`check-replies`/
`auto-enroll-cold-outreach` (one more function on the existing cron event). For each `active` run
whose `ends_at` hasn't passed:

1. **Scrape**: trigger the run's `source` scraper (`scrape-google-places`/
   `scrape-companies-house`) with the saved `icp_params`, capped to
   `min(60, daily_lead_target)` results — both scraper functions gain an optional
   `max_results` parameter for this (currently hardcoded to the existing ~60 ceiling; autopilot is
   the first caller that needs a smaller cap).
2. **Auto-approve, gated** (the quality guardrails summarized in §3e apply here — a `raw_leads`
   row is only approved into `leads` if it passes ALL of):
   - `status = 'pending'` (never `'duplicate'` — a known duplicate is never worth auto-contacting).
   - **Data-completeness bar**: has a real `email`, and at least one of `phone`/`website` present —
     too sparse to be worth contacting otherwise, matching what a human skimming the review table
     would naturally skip.
   - **Blocklist check**: its `email`'s domain, and its bare `email`, aren't present in
     `outreach_blocklist` for this org.
   - **Same-run re-dedup**: re-runs the existing dedup check (business_name+city or email, against
     both `leads` and `raw_leads`) at approval time, not just at scrape time — a lead first
     discovered on day 5 of a run needs deduping against everything added since day 1, which the
     one-time scrape-time dedup doesn't cover for a multi-day run.
   - **ICP-fit re-check**: the same `tight_icp_fit` boolean from §1d, re-verified here as a
     belt-and-suspenders check even though the scraper should already have filtered on it — cheap
     to re-check, and catches drift if the scraper's own filtering ever has a gap.
   Approved leads use the exact same write shape as the existing manual `approve()` action,
   service-role, `created_by = null` (system-approved, same visible-null-means-automated convention
   as `enrolled_by` in §1b). A lead that fails any check simply stays `'pending'` in `raw_leads` —
   available for a human to review manually later, not silently discarded.
3. **Enroll**: no new logic needed here — `auto-enroll-cold-outreach` (§1b) picks up these
   newly-approved `new_lead`-stage leads on its own next pass, since it's on the same schedule.
4. **Throttle sends, with ramp-up**: `check-sequences` gains a daily cap check for any org with an
   `active` `autopilot_runs` row. The effective cap for a given day is
   `daily_outreach_target` normally, but if `ramp_up_enabled`, the first 4 days of the run scale it
   down (`day 1: 25%`, `day 2: 50%`, `day 3: 75%`, `day 4+: 100%`, each rounded up to at least 1) —
   protects a mailbox that's never sent at volume before from an immediate full-rate blast. Before
   drafting a due step, count that org's `email_logs` rows created today with a
   `cold_outreach_*`/`jv_pitch_*` template; if already at the effective cap, skip this enrollment
   for today (its `next_send_at` is untouched, so it's simply picked up on a later run — the same
   self-healing backpressure this app already uses elsewhere, no data loss).
5. **Spend cap check**: before drafting, if `max_total_spend_cents` is set and
   `actual_ai_cost_cents` has already reached it, skip drafting entirely for this org for the rest
   of the run and set `status = 'cancelled'` — the same outcome as a manual Stop, just
   system-triggered. Checked once per `run-autopilot` invocation, not per-draft, since spend is
   tracked in whole-cents increments after each draft anyway.
6. **Bounce detection**: `check-replies` (§1e) already scans each verified user's inbox — extend
   that same scan to also flag messages that look like delivery-failure notifications (`From`
   header containing `mailer-daemon`/`postmaster`, or subject containing "undeliverable"/"delivery
   status notification"/"failure notice"). Each match increments a new
   `autopilot_runs.bounce_count integer NOT NULL DEFAULT 0`. If `bounce_count` crosses a fixed
   threshold (10, not user-configurable — a simple safety trip-wire, not another dial to tune) for
   an org with an active run, that run auto-cancels. **Flagging for review**: bounce detection via
   inbox-scan pattern-matching is a heuristic, not a real bounce-webhook integration (which would
   need provider-specific setup this app doesn't have) — it will miss some bounces and
   occasionally misfire on a real "delivery status" email that isn't actually a bounce; good enough
   as a coarse safety net, not a precise deliverability dashboard.
7. **Track**: increment `leads_scraped_total`/`outreach_sent_total`, add this run's actual drafted
   count × the real per-model price to `actual_ai_cost_cents`.
8. **End**: once `ends_at` passes, set `status = 'completed'`. No auto-renewal — the duration is a
   hard boundary, matching "for how long" being something the user explicitly set, not a default
   that silently continues.

### 3d. Transparency — live progress view

A widget on `/outreach/autopilot` (or a Dashboard card while a run is active) showing: day X of Y,
leads scraped so far vs. total target for the run, outreach sent so far vs. total target (today's
effective cap noted separately if ramp-up is still in its first 4 days), actual AI spend so far vs.
the original estimate range (and vs. `max_total_spend_cents` if set), current bounce count, and a
**Stop autopilot** button (`status = 'cancelled'`) — cancelling (manual or guardrail-triggered)
halts all future `run-autopilot` action for that org immediately; nothing already
scraped/approved/sent is undone, matching this app's non-destructive-by-default convention
throughout. A run that guardrail-cancelled itself (spend cap or bounce threshold) shows *why*, not
just that it stopped.

### 3e. Guardrail summary

| Guardrail | Trigger | Effect |
|---|---|---|
| Gradual ramp-up | First 4 days of a run, if `ramp_up_enabled` | Daily send cap scales 25%→50%→75%→100% |
| Deliverability warning | `daily_outreach_target > 30` at setup | Non-blocking warning shown before confirm |
| Total spend cap | `actual_ai_cost_cents ≥ max_total_spend_cents` (if set) | Run auto-cancels |
| Bounce-rate threshold | `bounce_count ≥ 10` | Run auto-cancels |
| Data-completeness bar | Auto-approval, every lead | Lead skipped (stays `'pending'` for manual review) |
| Blocklist | Auto-approval, every lead | Lead skipped |
| Daily re-dedup | Auto-approval, every lead | Lead skipped if it now matches an existing `leads`/`raw_leads` row |
| ICP-fit re-check | Auto-approval, every lead | Lead skipped if it no longer meets `tight_icp_fit` |
| Reply detected | Any point during a run | That lead's enrollment pauses (§1e) — not a run-level guardrail, but the same protective effect: a responsive lead stops getting auto-emailed |

---

## 4. Shared: Content-mining hook

The original doc's §6 "flag any reply, win, or interesting workflow run for future content" is a
manual habit (Kevin/contractors noting good outcomes), not something this build automates — no
schema or UI change proposed for it in this cycle. Noted here so it isn't silently dropped from
the requirement set, but it's explicitly deferred, not built.

---

## Testing

- Unit: the notes-then-draft routing logic in `_shared/ai.ts` (compatible-lead gate given
  priority-flag/tight-ICP-fit/human-notes, each signal tested independently and in combination;
  `tight_icp_fit`'s three-condition boolean tested against in-band, out-of-band, and
  boundary-value rating/review/industry inputs), and the reply-complexity classify-then-draft
  routing, matching this repo's existing test coverage style for `_shared/` helpers where it has
  any (check current coverage before assuming a pattern to follow).
- Live verification (controller-performed, matching this cycle's established pattern): throwaway
  org + lead combinations to prove the compatible-lead gate fires correctly on each of its three
  signals independently and that a lead meeting none of them correctly skips the Sonnet notes pass;
  confirm a `generateLeadNotes()` call only happens once per lead across multiple due touches (the
  second touch reuses the first's `ai_summary` note rather than calling Sonnet again); throwaway
  `linkedin_contacts` row with and without `context_signal` to prove template-variant selection;
  auto-enrollment cron run against a throwaway new_lead-stage lead to confirm one (and only one)
  enrollment is created and a second run doesn't double-enroll it; a throwaway sent `email_logs`
  row + a manually-injected IMAP test reply (a real test mailbox, not production) to prove
  `check-replies` correctly matches via `Message-ID` headers, pauses the enrollment, classifies
  simple vs. complex correctly on two deliberately distinct test replies, and respects
  `auto_draft_on_reply` in both states.
- Full E2E of an actual sent cold email / LinkedIn message, and of a real end-to-end IMAP reply
  round-trip, is out of reach without a real Anthropic key and a real IMAP-capable verified
  mailbox configured — same accepted pattern as cycle 4's Google Places/Companies House gap: ship
  with every rejection/skip/no-match path fully verified, flag the success paths as pending human
  steps once Kevin sets `ANTHROPIC_API_KEY` and re-verifies IMAP against his own real mailbox.
- `stripAiPunctuation()` is a pure function — straightforward unit tests for em-dash, en-dash, and
  spaced-hyphen inputs, plus a check that a hyphenated compound word (`"well-known"`, no
  surrounding spaces) is correctly left alone (the regex targets space-dash-space specifically, not
  every hyphen character).
- Live verification for autopilot (controller-performed, throwaway org): create a run with a small
  `daily_lead_target`/`daily_outreach_target`, confirm `run-autopilot` scrapes and auto-approves —
  seeding one manually-crafted `raw_leads` row for each quality guardrail (a `'duplicate'` status
  row, a row missing both phone and website, a row whose email domain is on a seeded
  `outreach_blocklist` entry, a row failing `tight_icp_fit`) and confirming each is correctly
  skipped while a clean row is correctly approved; confirm `check-sequences`' throttle respects the
  ramp-up percentage on a simulated "day 1" run and the full target from "day 4" onward; confirm a
  seeded `max_total_spend_cents` correctly auto-cancels a run once crossed; confirm a seeded run of
  10 bounce-pattern test messages correctly auto-cancels via the bounce threshold; confirm
  cancelling a run (manual or guardrail-triggered) stops all further action; full cleanup verified
  after, matching this project's established throwaway-data discipline.

## Out of Scope (this build)

- LinkedIn reply tracking — fully manual, no field for it yet (no inbox API exists to poll for a
  DM sent outside this app, unlike email's IMAP path).
- Autopilot for LinkedIn — the manual-send requirement makes "fully hands-off" impossible for that
  channel by definition; autopilot only covers cold email + JV pitch (the two sequence-engine
  channels).
- Autopilot for UX Tree / DI Academy — same rollout-order gate as the rest of this spec.
- Automated content-mining from replies/wins.
- UX Tree / DI Academy's own copy, ICP, and channel mix — needs a session with Valentina/Suj first,
  unrelated to whether the underlying plumbing (this spec) supports them (it will, once they
  configure their own Anthropic + SMTP keys).
- Any change to the existing internal/background AI (ICP parsing, note parsing) — those stay on
  Gemini exactly as they are today; this spec only adds a second, outreach-specific AI path
  alongside the existing one, never replaces it.
