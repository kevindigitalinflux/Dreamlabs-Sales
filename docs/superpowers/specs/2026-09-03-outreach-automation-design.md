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
| Outreach AI model | Claude, not Gemini (Gemini stays for internal/background AI — ICP parsing, note parsing, unchanged). LinkedIn DM + JV pitch always use Sonnet. Cold email auto-routes per lead: Sonnet if `lead_notes` exist for that lead at send time (a real personalization signal), Haiku otherwise (generic-fallback, higher-volume case). |
| Anthropic API cost model | BYO-per-org, matching the existing pattern — but specifically the *Gemini/Places/Companies-House* variant of that pattern (global fallback available), not the Apollo/Hunter variant (never falls back). Mr Brush & Co and DI Dreamlabs (`use_global_api_fallback=true`) fall back to Kevin's global `ANTHROPIC_API_KEY` if they haven't configured their own; UX Tree and DI Academy must configure their own key before any outreach channel activates for them, same as every other paid provider today. **Flagging this interpretation explicitly for review** — the brainstorming answer was "BYO-per-org, matching existing pattern," and this repo's "existing pattern" is genuinely two-tier (Gemini/Places/CH have a fallback for Kevin's orgs; Apollo/Hunter never do) — this spec picks the Gemini-style tier since Anthropic costs are Gemini-scale trivial, not Apollo/Hunter-scale meaningful. Say so if the no-fallback-ever variant was actually intended. |
| Auto-enrollment trigger | A lead newly approved into the pipeline (`stage = 'new_lead'`) with no existing active/paused `sequence_enrollments` row gets auto-enrolled into its org's default cold-outreach sequence. The schema already enforces max one active/paused enrollment per lead, so this can't conflict with a manual enrollment — a contractor manually enrolling a lead into a different sequence simply supersedes the automated one (same `enroll()` call already in `useEnrollments.ts`, no new conflict-handling needed). |
| JV pitch scope | Mr Brush & Co only, matching the original doc — the audience (local commercial real-estate/facilities contacts) isn't sourced via the scraper's ICP flow (different business type from cleaning-service prospects), so JV contacts are added manually, not auto-enrolled. |
| Rollout order | Mr Brush & Co + DI Dreamlabs first (Kevin's own two orgs). UX Tree / DI Academy's sequence copy, ICP, and channel mix still need a session with Valentina/Suj respectively before their workspaces go live — unchanged from the original doc, not part of this build. |

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

### 1c. AI routing (extends `_shared/ai.ts` + `check-sequences`)

`_shared/ai.ts` gains a Claude-backed sibling to `draftEmail`, same signature and contract (throws
on failure, returns `{subject, body}`), hitting `https://api.anthropic.com/v1/messages` instead of
Gemini's endpoint. Model name (`claude-sonnet-5` / `claude-haiku-4-5`) becomes a new parameter on
the shared function rather than a second near-duplicate function — one Claude-calling function,
model selected by the caller.

`check-sequences` changes:
1. `resolveOrgApiKey(service, orgId, 'anthropic')` alongside the existing Gemini resolution — only
   fetched when the due step's `template_type` starts with `cold_outreach_` or `jv_pitch_`
   (outreach templates), leaving every other template type's Gemini path completely untouched.
2. For `jv_pitch_*` template types: always Sonnet.
3. For `cold_outreach_*` template types: query `lead_notes` for this lead (already fetched a few
   lines above in the existing code, for template variable substitution) — if any notes exist,
   Sonnet; if none, Haiku.
4. If no Anthropic key is configured/resolved for an outreach template, skip drafting for that
   enrollment this run (same `skipped.push(...)` pattern already used for missing templates/leads)
   rather than falling back to Gemini — outreach content must never silently degrade to the wrong
   model's voice.

Everything downstream is unchanged: the AI-drafted result still lands in `email_logs` as a
`status: 'draft'` row, and shows up in the existing review queue (`useDrafts`,
`EmailReviewQueue.tsx`) exactly like any other AI-drafted follow-up — a contractor/Kevin reviews
and sends it through the existing `send-email` path. No new send infrastructure, no new UI for
these two channels' approval step.

### 1d. Reply handling

The original doc's "pause sequence on reply" (inbox webhook/polling) is **out of scope for this
build** — this repo has no IMAP/inbox-polling infrastructure today (SMTP is send-only), and
building real reply detection (webhook or polling, parsing, matching a reply to a lead/enrollment)
is a substantial separate piece of work with its own edge cases. Ship without it first: a
contractor manually pauses an enrollment (`useEnrollments.setStatus('paused')`, already built) when
they see a reply come into their own inbox. Flagged as a fast-follow, not silently dropped — see
Out of Scope.

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

## 3. Shared: Content-mining hook

The original doc's §6 "flag any reply, win, or interesting workflow run for future content" is a
manual habit (Kevin/contractors noting good outcomes), not something this build automates — no
schema or UI change proposed for it in this cycle. Noted here so it isn't silently dropped from
the requirement set, but it's explicitly deferred, not built.

---

## Testing

- Unit: the Claude-routing logic in `_shared/ai.ts` (model selection given template_type +
  notes-present), matching this repo's existing test coverage style for `_shared/` helpers where
  it has any (check current coverage before assuming a pattern to follow).
- Live verification (controller-performed, matching this cycle's established pattern): throwaway
  org + lead + notes combination to prove the Sonnet/Haiku routing fires correctly on both branches;
  throwaway `linkedin_contacts` row with and without `context_signal` to prove template-variant
  selection; auto-enrollment cron run against a throwaway new_lead-stage lead to confirm one (and
  only one) enrollment is created and a second run doesn't double-enroll it.
- Full E2E of an actual sent cold email / LinkedIn message is out of reach without a real
  Anthropic key configured and a real SMTP-verified org — same accepted pattern as cycle 4's
  Google Places/Companies House gap: ship with the rejection/skip paths fully verified, flag the
  success path as a pending human step once Kevin sets `ANTHROPIC_API_KEY`.

## Out of Scope (this build)

- Automatic reply detection/pause for cold email and JV pitch (inbox webhook/polling) — manual
  pause via the existing enrollment UI instead. Real scope for a later cycle once this ships and
  proves out.
- LinkedIn reply tracking — fully manual, no field for it yet.
- Automated content-mining from replies/wins.
- UX Tree / DI Academy's own copy, ICP, and channel mix — needs a session with Valentina/Suj first,
  unrelated to whether the underlying plumbing (this spec) supports them (it will, once they
  configure their own Anthropic + SMTP keys).
- Any change to the existing internal/background AI (ICP parsing, note parsing) — those stay on
  Gemini exactly as they are today; this spec only adds a second, outreach-specific AI path
  alongside the existing one, never replaces it.
