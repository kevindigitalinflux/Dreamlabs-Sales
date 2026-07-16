# Cycle 2 — Email Automation + AI Note Parsing — Design

**Date:** 2026-07-17 · **Status:** Approved by Kevin (scope, provider, and design confirmed in session)
**Source of truth:** SPEC.md §7 (Email Automation), §5 edge functions, §3 schema. Deviations noted inline.

## Goals

Ship the full Email Automation module — SMTP config, templates, AI-personalised composer,
sequences with a daily draft cron, review-before-send queue, email logs — plus enable the
"Let AI update this lead from your notes" toggle (parse-notes) that cycle 1 left disabled.

## Decisions locked during brainstorming

| Decision | Choice |
|---|---|
| Scope | Full SPEC §7 + parse-notes toggle in one cycle |
| Email providers | Gmail (app password) AND Outlook, both first-class; custom SMTP fields present |
| AI provider | Gemini **2.5** Flash free tier (SPEC's 1.5 is deprecated), behind a swappable `draftEmail()` interface |
| Puter.js / OpenRouter | Rejected: Puter.js is browser-side (cron can't use it); OpenRouter free tier too small/flaky. OpenRouter remains a possible future swap via the interface |
| Build approach | Fable 5 orchestrates; Sonnet subagents implement plan tasks |
| Automation register | `docs/AUTOMATIONS.md` — living list, updated every time an automation is added/changed |

## 1. Data & secrets

All email tables already exist in the live DB from migration 001
(`email_templates`, `email_sequences`, `sequence_enrollments`, `email_logs`,
`user_email_settings`). Migration `002_email_automation.sql` adds only:

- Seed 5 default templates (`is_default = true`, bodies drafted to SPEC's tone notes,
  `{{variable}}` syntax): Initial Follow-Up (48h), Second Chase (7d), Not Now Nurture (30d),
  Audit Confirmation, Proposal Follow-Up.
- Seed 2 default sequences: "Proposal Follow-Up" (steps: Day 0 Initial Follow-Up →
  Day 2 Second Chase → Day 7 Proposal Follow-Up) and "Not Now Nurture" (Day 0 → Day 30
  Not Now Nurture).
- Enable `pg_cron` + `pg_net`; schedule daily 06:00 UTC invocation of the
  `check-sequences` edge function via authenticated `net.http_post`.

**Secrets:** SMTP credentials go into **Supabase Vault**, written only by the
`email-settings` edge function (service role), under the deterministic secret name
`smtp_pass_<user_id>`. `user_email_settings` stores non-secret config only
(provider, smtp host/port/user, from_name, is_verified — columns already exist).
The client never reads or writes credentials directly.

**Variables supported in templates:** `{{first_name}}`, `{{business_name}}`,
`{{owner_name}}`, `{{audit_date}}`, `{{package_name}}`, `{{deal_value}}`,
`{{contractor_name}}`, `{{pain_point}}`, `{{cal_link}}`. Substitution is a pure,
unit-tested function; unknown/empty variables render as an empty string, and the
composer warns when a variable in the template has no value for this lead.
(`audit_date`, `pain_point`, `cal_link` have no lead column — they resolve from the
latest debrief note where possible and otherwise stay empty and warned.)

## 2. Edge functions

Shared module `supabase/functions/_shared/ai.ts` exposes
`draftEmail(input): Promise<string>` and `parseNotes(input): Promise<LeadSuggestion>`;
the only implementation this cycle calls Gemini `gemini-2.5-flash` (API key in function
secret `GEMINI_API_KEY` — **human step: Kevin creates the free AI Studio key**).
Provider swap = new implementation + env change.

| Function | Trigger | Behaviour |
|---|---|---|
| `email-settings` | client (authed) | Save/update SMTP creds to Vault; save non-secret config; "send test email" action |
| `generate-email` | client + `check-sequences` | Personalise template with lead data + latest notes via `draftEmail()`. On AI failure returns the plain substituted template with `ai_used: false` |
| `send-email` | client (authed) | Fetch creds from Vault by user, send via SMTP (Deno SMTP client; Gmail 465/TLS, Outlook 587/STARTTLS), update `email_logs.status` to `sent`/`failed` (+ error detail) |
| `check-sequences` | pg_cron daily | For active enrollments with `next_send_at <= now()`: draft the step's email → insert `email_logs` row `status='draft'` → advance enrollment pointer + compute next step's `next_send_at`; completes enrollment after last step. **Never sends.** |
| `parse-notes` | client (authed) | Note text + lead snapshot → suggested patch `{stage?, deal_value?, package_tier?, next_action_date?, next_action_note?, pain_point?}` with rationale. Client shows a before/after diff; nothing applies without the user clicking Apply |

Auth model matches cycle 1's `admin-users`: functions verify the caller's JWT; RLS-equivalent
checks server-side (contractors act only on their own leads/settings/logs).

## 3. UI

- **`/settings/email`** — provider picker (Gmail / Outlook / Other), provider-specific
  numbered instructions (Gmail app-password walkthrough per SPEC), masked credential
  fields, "Send test email" with success/failure feedback, current-config summary.
- **`/emails` hub** — replaces the ComingSoon stub; tabs: Templates / Sequences / Logs.
  - **Templates:** library list (default + own), editor with subject/body,
    variable-insert buttons, live preview against a sample lead. Admin can mark
    templates default (visible to all).
  - **Sequences:** library list; builder — name, step cards (delay days + template +
    optional subject override), drag to reorder (dnd-kit, same as Kanban), timeline
    preview strip ("Day 0 → Day 2 → Day 7"). Admin can mark default.
  - **Logs:** table (Date, Lead, Subject, Sent by, Status), row expand for full body,
    filters (lead, contractor for admin, date range), CSV export (client-side).
- **Composer modal** — opened from the lead panel/detail "Draft email" button (enabled
  now): template select → "Personalise with AI" → colour-coded diff of template vs AI
  draft → editable plain-text body + subject → Send. Also "save as draft" (status
  `draft`, appears in review queue).
- **Enroll in sequence** — from lead panel/detail: pick sequence, confirm start date;
  active enrollment (sequence name + step x/y) shows in the panel with pause/cancel.
- **Review queue** — dashboard "Emails ready to review" card goes live: drafts listed
  with company + subject + source (sequence step or manual), "Review & send" opens the
  composer pre-loaded; Send or Discard.
- **parse-notes toggle** — the NoteComposer checkbox becomes functional: after a note
  saves with the toggle on, the suggestion diff appears (current → suggested per field)
  with Apply / Dismiss. Applied changes go through the existing `applyLeadUpdate`
  path so stage changes keep auto-logging.

## 4. Error handling & safety rails

- **Review-before-send always.** No automation ever sends an email; only a user click does.
- Send failure → `email_logs.status='failed'` + `error_message` (existing column);
  failed drafts stay in the queue with the error visible and a retry.
- AI failure → plain template substitution, banner "AI unavailable — using template as-is".
- Cron failure → enrollment untouched (idempotent: due check re-picks it next run);
  function logs to Supabase function logs.
- Free-tier rate limits (10 RPM): `check-sequences` drafts sequentially with spacing;
  at this team's volume the 250/day cap is ample (noted in AUTOMATIONS.md).
- RLS: `user_email_settings` own-row only; `email_logs` own + admin;
  templates/sequences readable when default or own, writable by owner/admin (already
  in migration 001 — re-verified in the end-of-cycle audit).

## 5. Testing

- **TDD (vitest):** variable substitution, sequence schedule math (`next_send_at`
  computation incl. multi-step advance/completion), CSV export formatting,
  parse-notes suggestion→patch mapping.
- **Browser verification per task** (cycle-1 style): config wizard, template CRUD,
  composer diff + send, enrollment lifecycle, review queue, parse-notes apply.
- **Real end-to-end:** test email from Kevin's Gmail to himself; a 2-step test sequence
  with minute-level delays (cron invoked manually via HTTP) to prove draft → review →
  send → advance without waiting days.
- **End-of-cycle:** RLS audit script extended to the email tables; npm test + build.

## Out of scope (cycle 3+)

Lead scraper module, analytics, Cloudflare Pages deploy, HTML email bodies,
open/click tracking, timezone-aware send windows.
