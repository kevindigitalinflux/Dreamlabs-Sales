# Reply alerts and Replies inbox — Design

Date: 2026-10-27. Author: Claude (architect). Status: DRAFT, awaiting Kevin's approval. Builder: Codex on `codex/reply-alerts` (worktree `dreamlabs-sales-replies`); reviewer: Claude. Migration number 069 (065 is taken by the readiness badge, 066 to 068 are applied). Not built.

## Why
When a lead answers an email, nobody finds out unless they happen to read their inbox. Replies are already detected and saved (`check-replies` writes `email_replies`), but nothing in the app shows them, the check runs once a day, and replies to one-off emails (not sent through a sequence) are ignored altogether. Kevin wants users told quickly when a sent email gets a real reply, with an easy way to answer from the platform.

WhatsApp was dropped on 2026-10-27 (Kevin's decision); this feature is independent of it.

## Decisions (Kevin, 2026-10-27)
1. Alerts should arrive quickly, if that is free and manageable: target a few minutes.
2. Three alert kinds: in-app badge and banner, desktop popup, and email.
3. Notify both the person who sent the email and the organisation's admins.
4. Only real replies alert. Out-of-office replies, bounces and other automatic mail never alert.
5. A reply also moves the lead on: pauses its sequence (already true), sets the stage to Replied, sets the follow-up to today, and adds a note.
6. Each alert links to the reply. The user can ask the AI for a drafted answer and send it from the platform, after reading and editing it.
7. Only replies that arrive after release alert. Replies already stored stay quiet.
8. The app warns when a user's mailbox is not connected for reply detection, and walks them through connecting it.

## Architect's calls (not Kevin's; flagged for his review)
- A. New lead stage `replied`, placed between Contacted and Audit Booked. A reply moves a lead there only from `new_lead` or `contacted`; it never moves a lead backward or overwrites a later stage. (Kevin said yes to "set the stage"; a new stage is the cleanest reading. If he prefers no new stage, the fallback is a "Replied" badge on the lead with no stage change.)
- B. Follow-up "today" uses the Europe/London date (the app is UK-first and orgs have no stored timezone).
- C. A suspected "remove me" or "stop emailing" reply gets a warning chip and a one-click "Mark as opted out" button (uses the existing `leads.opted_out`). It never opts anyone out automatically.
- D. Desktop popups and email notifications show the business name and the first line only, never the whole reply.
- E. Email notifications are sent from the recipient's own verified mailbox to their own address, one summary email per person per check, never one email per reply. A person with no verified mailbox still gets in-app and desktop alerts.
- F. Replies are only seen in the INBOX folder. A reply that a mail rule files elsewhere, or that lands in spam, is not detected. The setup guide says so.
- G. The check interval is 5 minutes. Edge functions cannot hold an IMAP IDLE connection open, so this is the practical floor. Typical delay from reply to alert is 5 to 7 minutes.

## What exists today (verified 2026-10-27)
- `supabase/functions/check-replies/index.ts`: cron target, one run per verified mailbox with `imap_host` set. Matches a message to a sent email by `In-Reply-To` = stored `email_logs.message_id`, scoped to `sent_by` = that mailbox's user, and requires the reply's From address to match the lead (`replySenderMatches`). Stores `email_replies`, pauses the enrolment, optionally auto-drafts a response (`auto_draft_on_reply`, Haiku classifies, Sonnet for complex). Counts bounces toward autopilot.
- Gaps found: it skips every reply whose original email had no `sequence_enrollment_id` (so replies to composer emails are lost); the stored `body` is the raw MIME source cut at 5,000 characters (unreadable); no auto-reply filter beyond bounces; date-based IMAP search rescans each run; daily cron only (`check-replies-daily`, `55 5 * * *`, migration 006); no read state; `email_replies` RLS lets any org member read all replies regardless of lead visibility.
- `user_email_settings` has `imap_host`, `imap_port`, `last_imap_check_at`, `last_imap_check_uid`. An older mailbox has `imap_host` null until the user re-saves settings. `EmailConfig.tsx` has a Gmail guide but only an optional "IMAP host" field and no test for IMAP.
- Desktop popups for Jobs exist: `src/hooks/useDesktopNotifications.ts`, `src/lib/jobs/popups.ts`, with an opt-in switch. A notification bar and a Sidebar count badge pattern exist (`useNeedsInputCount`).
- `sendLeadEmail` supports no custom headers, so a reply sent from the app would not thread under the original.

## Design

### 1. Faster, complete reply detection (`check-replies`)
- Schedule: replace the daily cron with a 5-minute cron (same Vault-secret pattern as migration 061/049). The function skips a mailbox whose last successful check was under 4 minutes ago, processes the longest-waiting mailboxes first, keeps a wall budget under the Free plan limit (stop starting new mailboxes after about 110 seconds and carry on next run), and bounds messages per mailbox per run.
- Fetch by UID range above the saved watermark, not by date. A mailbox that has never been checked sets its watermark to the current highest UID and alerts for nothing (decision 7).
- Parse each message properly with `npm:postal-mime` (pinned version): plain text body (HTML converted to text server-side, never stored or rendered as HTML), `Message-ID`, `In-Reply-To`, `References`, headers, attachment count. Keep the matched-by-header rule, the `sent_by` scope and the From-address check exactly as today; they are the forgery guards.
- Match replies to any sent email, with or without a sequence. Pause an enrolment only when one exists.
- Real replies only (decision 4): skip messages with `Auto-Submitted` other than `no`, `X-Autoreply`/`X-Autorespond`, `Precedence: auto_reply|bulk|junk`, `X-Auto-Response-Suppress`, subject patterns (out of office, automatic reply, auto-reply, autoreply, away from the office), plus the existing bounce rules. Skipped counts are returned in the response for logging. One pure, import-free module holds all of these rules and is unit-tested with real-looking header sets.
- Idempotence: store the reply's own `Message-ID` and add a unique index so reprocessing after a lost watermark cannot duplicate a reply or its alerts.
- Record mailbox health on every run: `last_imap_ok_at`, `last_imap_error` (a safe fixed code, never the raw server text) and `last_imap_error_at`.

### 2. What a reply does (decision 5)
For each new real reply, in one place, in this order, each step guarded so a failure is logged and does not stop later steps:
1. Save `email_replies` (readable text, a short quote-stripped preview, full text, `message_id`, `opt_out_suspected`).
2. Pause the matched enrolment if any (existing behaviour).
3. Stage to `replied` per call A; `next_action_date` = today (London) unless it is already today or earlier; set `last_contacted_at` is NOT changed.
4. Add a lead note: "Reply received: <first 200 characters>". This note type must be excluded from AI context the same way `isSequenceSystemNote` excludes "Email sent:" notes (otherwise it would trigger the unbudgeted research pass in `check-sequences`). Extend that helper and test it.
5. Create alert rows (section 3).
6. If the sequence has `auto_draft_on_reply`, keep the existing auto-draft behaviour. The draft is a draft only; nothing is sent.

### 3. Alerts (decisions 2, 3, 7)
- New table `reply_notifications` (migration 069): `id`, `reply_id` (FK `email_replies`, cascade), `org_id`, `user_id`, `read_at`, `emailed_at`, `created_at`, unique `(reply_id, user_id)`. Recipients: the user who sent the original email (`email_logs.sent_by`) and every admin of the org, de-duplicated, who still belongs to the org and can see the lead. RLS: a user reads and updates only their own rows (update limited to `read_at`); inserts by the service role only. Add the table to the `supabase_realtime` publication.
- In-app: a "Replies" item in the Sidebar and mobile nav with an unread count badge, plus a banner under the top bar ("2 new replies", links to the inbox, dismissible per session) built the same way as the Jobs bar. Every hook that subscribes to realtime uses a per-instance channel name (known project rule).
- Desktop popup: extend the existing opt-in popup logic with a reply source. Same switch, same first-load baseline (no popups for what was already there), background-tab only like Jobs. Text per call D.
- Email: after a check, for each recipient with unsent alerts, send one summary email from their own verified mailbox to their own address through a minimal send helper (plain text: business names, first lines, a link to `/replies`). Set `emailed_at`. A per-user switch `user_email_settings.reply_alert_email` (default on) turns it off; it appears in Email settings.
- Reading a reply, opening the lead's reply, or "Mark all read" sets `read_at`.

### 4. Replies inbox and answering (decision 6)
- New page `/replies` (and a "Replies" section on the lead's page): unread first, each row shows business, contact, time, preview, a chip for "AI draft ready" and a warning chip for suspected opt-out. Opening one shows the reply text, the email it answers (subject, body, sent date), a link to the lead, and buttons: "Draft an answer with AI", "Write my own", "Mark opted out" (when flagged), "Mark handled".
- New edge function `draft-reply` (user JWT): checks org membership and `can_view_lead`, uses the org's own Anthropic key through `resolveOrgApiKey` (no global fallback change), reuses the classify-then-draft logic and `stripAiPunctuation`, company context and customer profile as `check-replies` does, returns subject and body. It never sends and never writes `email_logs` itself.
- The answer opens in the existing `EmailComposer`, prefilled and editable; the user clicks Send. Nothing is sent automatically (review-before-send). `sendLeadEmail` gains optional `inReplyTo` and `references` so the answer threads under the original in the lead's mail client; the reply's `Message-ID` is passed through `send-email`. Sending marks the reply handled.
- RLS tightening in the same migration: `email_replies` SELECT becomes membership AND `can_view_lead(lead_id)` (matching the 2026-09-29 decision-maker precedent). The analytics reply-rate query must keep working; the builder checks `useAnalytics` and adds a test.

### 5. Mailbox status, warnings and guided setup (decision 8)
- Status per user: Not connected (no `imap_host`, or never checked), Working (recent `last_imap_ok_at`), Problem (`last_imap_error`).
- Warnings, in plain words: a banner on `/replies` and on Email settings; a one-line note under the composer's Send button ("Replies to this email will not be picked up: connect your inbox"); a notice in Settings. Shown only when the user has a verified sending mailbox but reply detection is not working.
- Guided setup in `EmailConfig.tsx`: IMAP host and port filled automatically from the provider (Gmail `imap.gmail.com:993`; Outlook/Office 365 and Yahoo presets; custom shows the fields), the real steps for Gmail (turn on IMAP in Gmail Settings > Forwarding and POP/IMAP; use the same app password as sending), and a "Test reply detection" button. The test is a new `test_imap` action on `email-settings`: it logs in over IMAP with the saved credentials and returns a plain-English result (connected; wrong password; IMAP switched off in Gmail; cannot reach the server). It never returns raw server text. Saving settings auto-fills IMAP for existing Gmail users, which fixes older mailboxes that have `imap_host` null.
- Explicitly tell the user the limits from call F.

## Goals
Quick, accurate alerts; no missed replies to one-off emails; readable replies; fast, safe answering; users can see at a glance whether detection works.

## Non-goals and anti-goals
- No automatic sending of any answer, ever.
- No IMAP IDLE, push webhooks, Outlook Graph or Gmail API in this build.
- No scanning of other folders, no reading of unrelated mail: only messages whose headers match one of the user's own sent emails and whose From matches the lead are stored. An unrelated message must never be stored or alerted.
- No new paid provider. AI answers use the organisation's own Anthropic key as other drafting does.
- No change to WhatsApp or LinkedIn flows.
- Failure mode to avoid: an alert for something that is not a real reply, or a reply from the wrong person moving a lead.

## Constraints
- Existing forgery guards stay in force and are covered by tests.
- Secrets stay in Vault; no raw server or provider text reaches the browser.
- Never use a bare `catch {}`; log with a fixed message.
- Plain, short, jargon-free user text; accessible badge, banner and inbox; works at phone width in both themes; components under about 150 lines.
- Do not apply migrations or deploy; Claude reviews, Kevin approves each. Throwaway auth users must never be created on production, so the RLS audit keeps its fixture part separate from its read-only assertions.

## Tests and delivery
Failing tests first. Pure tests: auto-reply and bounce detection with realistic header sets, quote stripping and preview, opt-out phrase detection, stage rule (forward-only), note exclusion from AI context, recipient selection (sender plus admins, de-duplicated, lead visibility), email summary batching, IMAP error mapping. Integration-style tests for `check-replies` planning with injected IMAP and database. UI tests for badge count, banner, popup baseline, status banner states. RLS audit for `email_replies` and `reply_notifications`.

Edge functions to deploy when approved: `check-replies`, `draft-reply` (new), `send-email`, `email-settings`; plus any function importing the changed `sendLeadEmail` (`run-selected-autopilot`). Migration 069: columns, table, RLS, realtime, stage constraint, cron change.

## Left to the builder
Exact table and column names beyond those stated; the stage-constraint migration (read the live constraint first and list every file that enumerates stages: `STAGES`, Kanban columns, analytics funnel, the AI prompts that list stages, colour contrast of the new stage); the postal-mime integration under Deno; the summary-email wording; layout of the inbox.
