# Bulk Email Drafting + Release Queue — Design Spec

## Overview

Today, drafting an email for a lead is one-lead-at-a-time via
`EmailComposer` (template → optional AI personalise → save as draft or send),
and reviewing drafts happens one-at-a-time via the Dashboard's "Emails ready
to review" card (`EmailReviewQueue`). This spec adds a **bulk** path on top of
that existing, working machinery — not a replacement for it: multi-select
leads on the Pipeline, assign one template to the whole batch, generate a
draft per lead, then review and multi-select-release them from a new section
on the Emails page.

**Reuse, not rebuild.** `generate-email` (template + optional AI → subject/
body), the `email_logs` table's existing `'draft'`/`'failed'`/`'sent'` status
model, and `send-email` are all unchanged by this spec — bulk drafting is a
client-side loop over the same calls the composer already makes one at a
time. The only new backend work is a genuine, pre-existing gap this surfaces:
**no send path currently updates `leads.last_contacted_at`**, not even
today's single-send flow — fixed once, at the source, so every send path
benefits.

**Dependency on the bulk-enrichment spec (`2026-09-16-bulk-lead-enrichment-
design.md`):** that spec adds the `selected: Set<string>` multi-select
checkbox UI to `ListTable.tsx`/`PipelineList.tsx` (mirroring `ScraperJob.tsx`'s
pattern). This spec's "Draft emails" button reuses that same selection
state — it does not add its own. **Build order: implement the enrichment
spec first** (or at minimum its `ListTable`/`PipelineList` selection-state
task) so this spec's plan can add its toolbar button and modal against
selection state that already exists, rather than both plans independently
touching the same table component. If this spec is ever implemented alone,
its plan must include the enrichment spec's `ListTable`/`PipelineList`
multi-select task as a prerequisite step, not skip it.

## Data Flow — Bulk Generate

```
User selects leads on Pipeline → clicks "Draft emails" →
modal: pick one template, toggle "Personalise with AI" (on by default) →
"Generate drafts" →
client loops selected leads that HAVE an email address (sequentially, to
  avoid hammering generate-email/Gemini with a burst of concurrent calls):
    call generate-email({ lead_id, template_id, use_ai }) — unchanged
    insert into email_logs { lead_id, to_email: lead.email, subject, body,
      status: 'draft', sent_by: current user, org_id: currentOrg.id }
    — unchanged shape, matches EmailComposer's existing "Save as draft" insert
    exactly →
progress indicator updates per lead ("12 / 30 drafted…") →
summary: "Drafted 28 emails — 2 skipped (no email address)" →
link to the new release-queue section on /emails
```

Leads without an `email` are excluded up front (shown in the modal before
generating: "2 of 30 selected leads have no email address and will be
skipped") rather than failing individually mid-loop.

## Data Flow — Release

```
Emails page → "Waiting to release" tab → same drafts as the Dashboard's
  existing "Emails ready to review" card (useDrafts(), status IN
  ('draft','failed'), org-scoped, RLS: own + admin-sees-all — unchanged) →
multi-select (checkbox pattern, same as Pipeline/ScraperJob) →
"Release selected (N)" →
client loops selected drafts sequentially:
    call send-email({ to_email, subject, body, lead_id, log_id }) — unchanged
→
refresh() re-queries status IN ('draft','failed') — sent rows now have
  status='sent' and drop out of the result set automatically, satisfying
  "disappear once released" with no new logic
→ summary: "Sent 9 — 1 failed (stays in the queue, marked Failed)"
```

Individual "Review & send" (opens `EmailComposer` prefilled) and "Discard"
stay available per-row alongside the new checkboxes — bulk release is an
additional way to act on many at once, not a replacement for careful
one-by-one review when that's what's wanted.

## Ownership Model

A bulk-generated draft's `sent_by` is the person who ran the bulk action —
identical to how `EmailComposer`'s existing "Save as draft" already sets
`sent_by`, regardless of which lead the draft is for. Releasing sends through
*that* person's connected mailbox (`user_email_settings`, checked by
`send-email` exactly as it is today). This means whoever runs a bulk-draft
batch must have their own Settings → Email sending mailbox connected before
release will work — the existing "Set up and verify your email in Settings →
Email sending first" error surfaces exactly as it already does for the
single-lead flow, no new error path needed.

## UI: Bulk Generate Modal

New component `src/components/pipeline/BulkDraftModal.tsx`, a `Modal` opened
from a new "Draft emails" button in `PipelineList.tsx`'s toolbar (next to
"Fill missing details" from the enrichment spec, same `selected.size > 0`
visibility condition; icon: `Send` or `PenLine` — distinct from enrichment's
Radar icon so the two bulk actions are visually distinguishable at a glance).

Contents: a `SelectField` for template (same `useTemplates()` list
`EmailComposer` already uses), a checkbox "Personalise with AI" (default
checked), a line disclosing any lead-without-email count, and a "Generate
drafts" button that runs the loop above with a live progress line. On
completion, closes with a summary toast and a link/button to jump to
`/emails?tab=release`.

## UI: Release Queue Tab

`EmailsHub.tsx` gains a fourth tab, `'release'` / "Waiting to release",
alongside the existing Templates/Sequences/Logs (tab order: Templates,
Sequences, **Waiting to release**, Logs — placed before Logs since it's an
actionable queue, not a historical record). New component
`src/components/emails/ReleaseQueue.tsx`:

- Reuses `useDrafts()` as-is (no hook changes needed — it already returns
  exactly the right rows).
- Renders the same per-row content `EmailReviewQueue` already renders
  (business name, Sequence/Manual badge, Failed badge, subject, individual
  Review & send / Discard), with a header "select all" checkbox and a
  per-row checkbox added in front, matching the `ScraperJob.tsx` pattern used
  in the enrichment spec.
- A "Release selected (N)" button appears when any rows are checked, runs the
  release loop above with a progress line, then calls the same `onChanged`/
  `refresh()` callback `EmailReviewQueue` already uses.
- The Dashboard's existing "Emails ready to review" card is **unchanged** —
  kept for quick one-by-one daily triage, per the explicit decision to keep
  both surfaces rather than consolidate.

## Fix: `last_contacted_at` and stage on send

`supabase/functions/send-email/index.ts` currently builds `row` (the
`email_logs` insert/update payload) and writes it, but never touches `leads`.
Add, immediately after a successful send (`status === 'sent'` and
`body.lead_id` is set):

```typescript
if (status === 'sent' && body.lead_id) {
  const { data: currentLead } = await service.from('leads').select('stage').eq('id', body.lead_id).maybeSingle();
  const leadUpdate: Record<string, unknown> = { last_contacted_at: new Date().toISOString() };
  if (currentLead?.stage === 'new_lead') leadUpdate.stage = 'contacted';
  await service.from('leads').update(leadUpdate).eq('id', body.lead_id);
  // Best-effort: a failure here must not turn a successful send into an
  // error response — the email already sent and logged either way.
}
```

This runs for **every** send through this function — manual composer sends,
sequence-driven sends, and the new bulk release — so the fix is universal,
not bulk-only. Stage only ever advances `new_lead → contacted`; any other
current stage (`negotiating`, `won`, `not_now_nurture`, etc.) is left alone,
so a reply to an already-advanced lead never gets silently reset backward by
a later send.

## Error Handling

- `generate-email` failing for one lead mid-batch (e.g. Gemini quota, network
  blip): caught per-iteration, that lead is reported in the summary as
  skipped with a reason, the loop continues to the next lead — one bad
  generation must not abort the whole batch.
- `send-email` failing for one draft mid-release (e.g. SMTP auth expired):
  already returns a `'failed'` status and updates the log row accordingly
  (existing behavior, unchanged) — that row simply stays in the queue marked
  Failed instead of disappearing; the release loop continues to the next
  selected draft rather than stopping.
- Releasing with no verified mailbox connected: the existing "Set up and
  verify your email..." error surfaces per-draft in the summary; none of the
  batch silently succeeds partway through a misconfigured account (every item
  in a from-this-user batch fails the same way, so the summary reads clearly
  as a setup problem, not scattered failures).

## Testing

- `BulkDraftModal`: component test for the has-no-email exclusion count and
  for building the correct `generate-email` + `email_logs.insert` call
  sequence for a small selection (assert `sent_by` is the current user for
  every row, not the lead's `assigned_to`).
- `ReleaseQueue`: component test for per-checkbox toggling, "select all", and
  that a successful `send-email` response removes that row from the next
  `useDrafts()` result (via a mocked `refresh()`).
- `send-email`'s new lead-update branch: unit/integration test covering
  three cases — `stage: 'new_lead'` advances to `'contacted'` alongside
  `last_contacted_at`; `stage: 'negotiating'` (or any non-`new_lead` value)
  updates only `last_contacted_at`, stage untouched; a failed send
  (`status !== 'sent'`) never touches `leads` at all.
