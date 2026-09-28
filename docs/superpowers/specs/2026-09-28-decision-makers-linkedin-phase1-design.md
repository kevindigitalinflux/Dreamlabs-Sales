# Decision Makers as Persistent Lead Records + LinkedIn Queue Overhaul (Phase 1) — Design Spec

## Overview

Live user testing of the decision-maker-enrichment feature (shipped
2026-09-24) surfaced two problems with its current design:

1. **"Add to lead" / "Reveal email" overwrite the lead's own
   `owner_name`/`email`.** A lead can only ever remember one contact this
   way — finding a second decision-maker (or re-running the search) silently
   clobbers whatever was found before. Decision-makers need to be a real,
   persistent, multi-entry record on the lead, not a value copied over the
   lead's own primary contact fields.
2. **LinkedIn outreach (`LinkedinOutreach.tsx`, shipped in the cycle-5
   outreach-automation build) has no concept of a lead or a pipeline at all.**
   `linkedin_contacts` is a flat, org-wide, manually-entered list. There is no
   way to find a decision-maker's LinkedIn profile automatically, no way to
   see LinkedIn contacts grouped by pipeline, and no bulk drafting.

This spec (Phase 1 of two) fixes both: decision-makers become a persistent,
multi-entry part of a lead's record; email drafting can fan out to one or
more of them; and the LinkedIn queue gains a real link back to leads/
pipelines plus search, filter, and bulk drafting. **Phase 2** (a separate
spec/plan, built right after) adds a Loom-video-link field and AI-generated
video talking points to both the email and LinkedIn composers — deliberately
split out because it's additive on top of whatever composer UI this phase
produces, and doing both at once risks a plan too large to review well.

**Explicitly out of scope for both phases**: automating LinkedIn message
*sending*. LinkedIn's official APIs don't offer this for cold outreach
without a partnership LinkedIn doesn't grant to businesses like this one, and
every unofficial automation route (browser-automation tools, unofficial API
access) violates LinkedIn's User Agreement and carries real account-ban risk.
Sending stays a manual, human action; this project only ever drafts the
message and tracks whether it was sent.

## Data Model

### `decision_maker_candidates` — add `linkedin_url`, drop the lead-write

```sql
ALTER TABLE decision_maker_candidates ADD COLUMN linkedin_url TEXT;
```

No other schema change to this table. Semantically, though, this phase
changes what happens to it: **every row found is now the persistent record**
— there is no more "apply" step that copies data elsewhere. Hunter rows
arrive with `email_revealed = true` (unchanged). Apollo rows still require
the existing explicit "Reveal email"/"Reveal phone" actions before contact
info appears (unchanged) — revealing writes onto *this* candidate row only,
never onto `leads.email`/`leads.owner_name` (removed from
`reveal-decision-maker` and `apollo-phone-webhook`, see below).

### `email_logs` — add `decision_maker_candidate_id`

```sql
ALTER TABLE email_logs ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;
```

Nullable, set only when a send's recipient was a decision-maker rather than
the lead's own email. This is what lets the Decision Makers section show
"last emailed 3 days ago" per contact later — cheap to add now, awkward to
retrofit later since it needs to be populated at send time.

### `linkedin_contacts` — add `lead_id` and `decision_maker_candidate_id`

```sql
ALTER TABLE linkedin_contacts ADD COLUMN lead_id UUID REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE linkedin_contacts ADD COLUMN decision_maker_candidate_id UUID REFERENCES decision_maker_candidates(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX linkedin_contacts_candidate_unique ON linkedin_contacts (decision_maker_candidate_id) WHERE decision_maker_candidate_id IS NOT NULL;
```

Both nullable — existing manually-added contacts keep working exactly as
they do today, with `lead_id = NULL`, shown under an "Unlinked" bucket in the
redesigned queue rather than disappearing or erroring. The partial unique
index on `decision_maker_candidate_id` makes the auto-capture step
(below) idempotent: re-running "Find decision maker" for a lead whose
candidate already has a LinkedIn contact updates that same row via
`upsert(..., { onConflict: 'decision_maker_candidate_id' })` instead of
creating a duplicate.

RLS on `linkedin_contacts`/`linkedin_drafts` is unchanged
(`is_org_member(org_id)`) — `lead_id` is an org-scoped foreign key on an
already org-scoped table, so no new policy is needed; a lead from a
different org can never be referenced because nothing in this app lets a
client supply a foreign `lead_id` without also supplying its own org's
`org_id`, and the write path here is server-side (see below).

## Backend Changes

### `find-decision-makers` — capture LinkedIn URL, auto-create LinkedIn contact

For each candidate upserted (Hunter or Apollo), if the provider response
includes a LinkedIn URL, store it and auto-upsert a linked
`linkedin_contacts` row:

- **Hunter** (`_shared/apolloHunterLookup.ts`, `findHunterDecisionMaker`):
  Hunter's domain-search email objects include a `linkedin` field per
  contact when known. Add it to the parsed `HunterEmailEntry` interface and
  the returned `HunterDecisionMakerCandidate` shape (`linkedinUrl: string |
  null`).
- **Apollo** (`_shared/apolloPeopleSearch.ts`, `searchApolloDecisionMaker`):
  Apollo's person objects document a `linkedin_url` field. Add it to the
  parsed response type and `ApolloPersonCandidate` (`linkedinUrl: string |
  null`). **Live-verify this once Mr Brush & Co (or another org) has a
  non-Free Apollo plan** — Hunter's field is verifiable today (their free
  tier works for this org), Apollo's cannot be until the plan-block lifts;
  until then, code defensively for the field being absent (`null`), which is
  already this function's existing behavior for any missing field.

After upserting the candidate row, if `linkedin_url` is non-null:

```ts
await service.from('linkedin_contacts').upsert({
  org_id: lead.org_id,
  lead_id: lead.id,
  decision_maker_candidate_id: candidateId,
  full_name: `${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Unknown',
  linkedin_url: linkedinUrl,
  context_signal: title ? `${title} at ${lead.business_name} — found via decision-maker research` : `Found via decision-maker research for ${lead.business_name}`,
}, { onConflict: 'decision_maker_candidate_id' });
```

No new edge function needed — this is an addition to the existing
`find-decision-makers` handler's per-candidate loop.

### `reveal-decision-maker` / `apollo-phone-webhook` — stop writing to `leads`

Both currently write the revealed email/phone directly onto
`leads.email`/`leads.owner_name`/`leads.phone` after a successful reveal
(from the original spec's "explicit, already-consented action, skip the
diff-review step" reasoning). That write is removed from both functions —
the revealed value now lives only on the `decision_maker_candidates` row,
which the UI reads directly. Nothing else about either function changes
(the reveal flow, credit-spend gating, webhook security, and constant-time
token comparison all stay exactly as already reviewed and shipped).

### `send-email` — accept a decision-maker recipient

Currently: `to_email` is a free-text field the caller supplies, and
`lead_id` is required to resolve `org_id`/membership. This still works
unchanged for sending to a decision-maker's email — the caller (the
composer) just passes that contact's email as `to_email` and the *same*
`lead_id` (the decision-maker's own lead), plus a new optional
`decision_maker_candidate_id` in the request body, stored on the
`email_logs` row when present. No other change: membership/ownership checks,
the `last_contacted_at`/stage-advance logic, and draft-claiming rules are
already lead-scoped, not email-scoped, so they apply correctly regardless of
which specific recipient at that lead's company the email went to.

## UI

### Lead detail page — new "Decision Makers" card

New component `DecisionMakersCard.tsx`, added to `LeadDetailPage.tsx`
alongside the existing Contact/Pipeline/Notes cards. Lists every
`decision_maker_candidates` row for `lead.id` (a live query + the same
`postgres_changes` subscription pattern `DecisionMakerReview` already uses,
scoped to `lead_id = this lead` instead of a candidate-id list):

```
Decision Makers
  Hunter    Jane Doe — CEO — jane@company.com                [🔗 LinkedIn]
  Apollo    Andrew Hu***n — Professor...                     [Reveal email] [Reveal phone]
```

Reveal buttons behave exactly as in the existing review modal (same
`reveal-decision-maker` call, same realtime-driven "Waiting for phone
number…" state). The `[🔗 LinkedIn]` link renders whenever
`linkedin_url` is set, opening in a new tab. No "Add to lead" button exists
anywhere anymore — being found is being kept.

### `DecisionMakerReview.tsx` (the bulk-search results modal) — simplified

Still opened from "Find decision maker" on `PipelineList.tsx`'s multi-select
toolbar, for seeing what turned up across many leads in one place without
visiting each lead's detail page. Changes:
- Hunter rows drop the "Add to lead" button entirely (nothing to add —
  already visible on the lead's own Decision Makers card by the time this
  modal is open).
- Apollo rows keep "Reveal email"/"Reveal phone" unchanged.
- Add a one-line hint at the top: "Full contact list for each lead is on its
  Decision Makers section."

### `EmailComposer.tsx` — multi-recipient checklist

Before the existing template/AI-personalization controls, a new checklist:
the lead's own email (if set) plus every decision-maker with a non-null
email, each as a checkbox (defaulting to just the lead's own email checked,
preserving today's behavior when nothing else is checked/available).
"Generate"/"Send" now iterates the checked recipients — each produces its
own independently drafted (if AI personalization is on, personalized to
that specific person's name/title, not just the lead) and independently
sent email, each its own `send-email` call and `email_logs` row against the
same `lead_id`. A lead with zero decision-makers behaves exactly as today
(one recipient, no checklist shown — just the existing single-recipient UI).

### `BulkDraftModal.tsx` — one toggle, not per-lead checkboxes

Adds one new toggle: **"Also include decision-maker contacts."** Off
(default): unchanged — one draft per lead, the lead's own email only. On:
one draft per lead *per available recipient* (the lead's own email if set,
plus every decision-maker with a revealed email) — still one template, one
AI-personalization setting, applied uniformly; per-recipient personalization
of the *name* still happens (existing `draftEmail`/`draftEmailClaude`
already take the specific recipient context), just not a per-contact
opt-in/out across potentially dozens of leads at once.

### LinkedIn queue (`LinkedinOutreach.tsx`) — search, filter, bulk draft

- **Search box**: matches against the contact's own `full_name` or (when
  `lead_id` is set) the joined lead's `business_name`.
- **Pipeline filter**: a dropdown of the org's pipelines plus an "Unlinked"
  option (contacts with `lead_id IS NULL`) and "All". Filters both the
  pending-contacts list and the drafts/review-queue list.
- **Multi-select + bulk draft**: checkboxes on the pending-contacts list
  (same pattern as `PipelineList`'s lead selection) and a "Draft messages
  (N)" button that calls the existing `draftFor` once per selected contact
  (bounded concurrency, matching `runBounded`'s existing use elsewhere —
  this is multiple independent AI calls, not a new batch endpoint).
- **"Mark as sent" also updates the linked lead**, when `contact.lead_id` is
  set: `useLinkedinOutreach.ts`'s `markSent` is extended to accept the full
  draft object (not just two ids, so it has the message text and
  `contact.lead_id` without an extra fetch), and on success additionally:
  1. Inserts a `lead_notes` row: `"LinkedIn message sent to <full_name>:\n\n<message>"`.
  2. Updates `leads.last_contacted_at` to now, and — mirroring `send-email`'s
     existing safety rule exactly — advances `stage` from `new_lead` to
     `contacted` **only** when the lead is currently `new_lead`, never any
     other stage.
  A contact with no `lead_id` (manually added) behaves exactly as today —
  only the draft/contact status changes, nothing lead-side to update.

## Error Handling

- LinkedIn URL missing from a provider response (the common case today,
  until live-verified) → no `linkedin_contacts` row is created; nothing
  visible changes versus today's behavior.
- `linkedin_contacts` upsert failure (e.g. transient DB error) → logged
  server-side, does not fail the candidate upsert or the overall
  `find-decision-makers` batch — LinkedIn capture is additive, never
  load-bearing for the decision-maker search itself.
- Email composer: if one recipient's send fails (bad address, SMTP error),
  the others still proceed independently — a per-recipient result list is
  shown (matching `BulkDraftModal`'s existing "N of M succeeded" pattern),
  not an all-or-nothing batch.
- `markSent`'s lead-side update (note + stage) is a best-effort follow-up
  to an already-successful draft/contact status change — if it fails
  partway, the message is still correctly marked sent and out of the queue;
  the note/stage-advance can be manually redone if genuinely needed (matches
  this project's existing tolerance for this exact class of non-transactional
  multi-step write, documented elsewhere for `check-sequences`).

## Testing

- Hunter/Apollo response parsing: extend existing unit-test coverage (or
  add, if none exists yet for these specific parse functions) to cover a
  response with and without a LinkedIn field present.
- `find-decision-makers`: live-verify (this project's established pattern)
  that a Hunter candidate with a LinkedIn URL produces both the candidate
  row and a linked `linkedin_contacts` row with the correct `lead_id`, and
  that re-running search on the same lead upserts rather than duplicates.
- `reveal-decision-maker`/`apollo-phone-webhook`: live-verify the `leads`
  table is genuinely untouched after a reveal (only the candidate row
  changes) — a direct regression check against the exact bug being removed.
- `EmailComposer`/`BulkDraftModal`: live-verify sending to 2+ recipients for
  one lead produces 2+ independent `email_logs` rows, each with the correct
  `to_email` and `decision_maker_candidate_id` (or null for the lead's own
  email).
- LinkedIn queue: live-verify search/pipeline-filter against real linked and
  unlinked contacts, and that `markSent` on a lead-linked contact produces
  the expected `lead_notes` row and stage transition (and does *not*
  transition a lead that isn't `new_lead`).
