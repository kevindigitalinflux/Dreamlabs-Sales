# Reply alerts, Replies tab and mailbox status — local build report

Date: 2026-10-27. Builder: Codex. Architect/reviewer: Claude. Independent review pending.

## Scope, base and revisions

Worktree: `C:/Users/kevin/Projects/dreamlabs-sales-replies`; branch: `codex/reply-alerts`.
Binding requirements: `docs/REPLY-ALERTS-BUILD-BRIEF.md` and the approved `docs/superpowers/specs/2026-10-27-reply-alerts-design.md`, sections 1–5.

The requested initial `git fetch origin` succeeded, but main still resolved to `ece88ed` without readiness. The first rebase onto that ref was a no-op. Kevin then explicitly answered **“Use the local readiness branch instead.”** Rebase onto `codex/readiness-and-fixes` at `546d7be8b6543feaa04af20b507322dae0ee9250` completed cleanly, preserving the existing readiness and mailbox-retry work. Rebased brief HEAD/baseline: `0dac5a86c156dfb1744ee577497e83f0862a15db`. The checkout was clean before work. At final read-only verification, the shared `origin/main` tracking ref also resolved to `546d7be`; no builder push or merge occurred.

Final tested application revision: **`421e4f802e240c77bd137b961540376ab4c29039`**. Documentation checkpoint: `7d8e2cdf1b02858395fc3cd8f892ec46cc07b925`. This report follows in a final documentation-only commit; use `git log` for its hash.

Build commits, in order:

| Commit | Work |
|---|---|
| `7a782f8` | Pure admission, follow-up, alert, threading and mailbox rules; system-note exclusion |
| `53b0313` | Migration 069 and separately marked rollback audit blocks |
| `ac2c7f3` | UID/MIME polling, reply effects, optional drafts and actual upstream dependency declarations |
| `ed34492` | Authorised draft endpoint, reply access checks and threaded sending |
| `c6fe1ca` | Replied stage, AI stage lists and analytics/FK regression |
| `73fe773` | Pre-release cutoff, deadline guards, safe errors and endpoint/SMTP tests |
| `7133bb3` | Inbox connection test, health and guided setup |
| `8994d71` | Replies tab, alerts, badges, banner, popups and editable answer flow |
| `c00bf3a` | Accessibility refinements, receipt-time guard and expanded edge graph checks |
| `e6c7942` | Complete decoded text retained within the source limit |
| `421e4f8` | Older unread replies included outside the recent-message window |

Every commit used explicit file paths, disabled hooks and the required Codex trailer. No other checkout or vault file was edited. No push, merge, deployment, migration/audit execution, remote application write, actual email/message or paid provider call occurred. Network activity was limited to the requested Git fetch and package acquisition needed for local dependencies. Subscription usage is unavailable; no percentage is asserted.

## 1. Faster, complete detection

Replaced date rescans with bounded ascending UID scans of the sender's INBOX. The proposed migration replaces `check-replies-daily` with a five-minute job using the existing Vault cron-secret pattern. The handler rejects an absent configured cron secret, checks longest-waiting mailboxes first, skips successful checks less than four minutes old and stops admitting mailboxes with less than 20 seconds left in its 110-second budget. IMAP operations have connection/socket timeouts and a deadline close; optional auto-drafting also has a remaining-budget timeout.

A never-checked mailbox quietly baselines to the current highest UID. A migration-time `reply_alerts_after` cutoff also keeps older, previously missed mail quiet for already-checked mailboxes. That comparison uses IMAP server receipt time, not the sender-controlled Date header. Missing receipt-time evidence fails safely. No stored replies are backfilled into notifications.

MIME parsing uses **`npm:postal-mime@2.4.3`**, with actual multipart/quoted-printable fixtures. Plain text is preferred; an HTML-only body becomes plain text server-side. Admitted messages retain their complete decoded text, with a short quote-stripped preview, own Message-ID, threading references, attachment count and suspected opt-out flag. No HTML is rendered from replies, and attachments are counted rather than stored/downloaded by the UI.

The existing forgery boundaries remain: header matches are restricted to `email_logs.status = sent` and `sent_by = this mailbox owner`; the From address must pass the existing `replySenderMatches` rule. Matching also checks References ancestors, and works without a sequence enrollment. Wrong-mailbox, wrong-sender and unrelated messages produce no reply/lead/alert writes.

Pure rules reject Auto-Submitted other than `no`, X-Autoreply/X-Autorespond, bulk/junk/auto_reply precedence, X-Auto-Response-Suppress, the specified automatic-subject patterns and existing bounce patterns. Automatic/bounce counts are returned without storing those messages as replies or alerts. Existing discover-run bounce accounting and its threshold are retained.

The reply's Message-ID has a unique index. A duplicate insert performs no later note, draft or notification effects. Save failure prevents advancing beyond the failed UID; mailbox health records a fixed safe code. `last_imap_ok_at`, `last_imap_error` and `last_imap_error_at` are maintained without returning/logging raw mail/server payloads.

## 2. What a real reply changes

One orchestration path saves the reply first, then independently guards these effects in the specified order:

1. Pause an existing matched active/paused enrollment, if any.
2. Advance only New Lead or Contacted to Replied. Later stages remain unchanged. Set the follow-up to today's Europe/London date only when it is absent or later; retain an already-due date. Never change `last_contacted_at` on receipt. Stage/date writes compare the read snapshot so a concurrent human edit is not overwritten.
3. Add `Reply received: <preview>` as a general lead note.
4. Create alerts for the current sender membership and visible organisation admins, de-duplicated.
5. Keep the existing optional sequence classify-then-auto-draft behavior. Haiku handles simple replies, the existing Sonnet model handles complex replies, company/customer-profile context is retained, and the result remains a draft addressed to the trusted original recipient. Nothing sends automatically.

`isSequenceSystemNote` now excludes Reply received notes wherever the existing helper is used, including manual generation, selected Autopilot and reply drafting. The separate SQL human-note count in `check-sequences` excludes the same prefix, preventing it from triggering an unbudgeted research pass.

Replied is included in the type union, STAGES ordering, icons, badge/card styling, Dream Agent whitelist, AI prompt stage lists and analytics funnel. Kanban and stage selectors already derive from STAGES. The original CHECK's eight values were read from migration 001 and retained verbatim alongside `replied`; no live constraint query or SQL execution occurred.

Stage enumeration/styling inventory reviewed: `src/types/index.ts`, `src/lib/utils.ts`, `src/components/pipeline/stageStyles.ts`, `src/index.css`, `src/lib/dreamAgentActions.ts`, `src/lib/analytics.ts`, and `supabase/functions/_shared/ai.ts`. Static token calculations give the Replied badge approximately **5.14:1 light / 7.26:1 dark**, and the unread count badge **7.78:1**. These calculations do not establish rendered browser contrast.

## 3. In-app and desktop alerts

Migration 069 adds `reply_notifications` with unique `(reply_id,user_id)`, cascading reply/profile/org links, own-row SELECT, column-only UPDATE for `read_at`, service-only inserts and realtime publication. Notification access also retains current org membership and reply visibility. A service-only recipient RPC reproduces the existing pipeline/lead visibility rules for explicit candidate users; departed or hidden senders do not receive alerts.

A shared user/org-scoped provider supplies the Sidebar and new mobile Emails badge, exact unread count, a session-dismissible banner and desktop popups. Its realtime channel includes a per-instance identifier. Scope changes suppress stale responses; no unpublished table is subscribed to. Desktop replies reuse the existing Jobs opt-in, first-load baseline and background-tab-only policy, displaying only business and first line. Failed initial lookups do not turn recovery into a burst of old popups. Scope changes/unmount close outstanding popups.

Opening a reply marks its own alert read, including a direct link older than the current notification batch. Mark all read updates only the current user's current-org rows. Other users' read state is untouched. There is **no notification email**, `emailed_at` column or email-notification switch.

## 4. Replies tab and answering

Replies lives in the existing Emails page at **`/emails?tab=replies`**. No page or route was added. With no explicit tab selected, unread replies make Replies the default; explicit tab links win. Tabs wrap at narrow widths and support arrow/Home/End keyboard navigation and panel labels. Lead pages have a short Replies section linking to the same detail view.

The inbox loads recent replies plus the current unread batch, so older unread replies are not hidden behind a recent read-message window. It sorts unread first and shows business, sender, time, preview, AI-draft-ready and possible-opt-out/handled text. Opening one shows plain reply text, original subject/body/sent time, attachment count and lead link. The user can review an existing AI draft, request a new AI answer, write their own, explicitly mark opted out or mark handled. Opt-out detection never changes the lead automatically; its button uses existing edit RLS.

New `draft-reply` authenticates the user JWT, checks membership plus caller-session `can_view_lead`, uses the organisation's own Anthropic key through the unchanged key resolver and returns a cleaned subject/body. It never sends or writes `email_logs`. The existing composer opens a single trusted original recipient with an editable answer; the human must click Send. Saving as a draft retains its reply link.

`send-email` derives threading data from the authorised stored reply, including when releasing a linked saved draft; arbitrary client header/recipient substitution is rejected. `sendLeadEmail`/SMTP pass validated In-Reply-To and References, rejecting header injection. Successful reviewed sends mark handled and read; failures do not. SMTP/database payloads are no longer exposed through the modified send path's logs/error text.

Reply SELECT is tightened with membership plus lead visibility. A restrictive SELECT policy also prevents the old permissive admin-FOR-ALL policy from bypassing that read boundary; existing write policies and grants are left unchanged. `reply_mark_handled` exposes only the authorised handled-state operation without granting general reply UPDATE to viewers.

The analytics query keeps its original sent-log visibility join, now naming `email_replies_email_log_id_fkey` explicitly. New original/draft/reply foreign keys would otherwise make that join ambiguous. An integration-style hook regression verifies reply-rate data still loads, and the funnel includes Replied.

## 5. Mailbox health and setup

Added safe Not connected / Working / Problem text on Email settings; verified senders whose detection is not working receive warnings in Replies, Settings and a short note below Send. Health refreshes without subscribing to an unpublished settings table. Settings responses are user-scoped and stale-user responses are suppressed.

Gmail, Outlook/Office 365 and Yahoo presets fill IMAP host/port; custom settings expose fields. The Gmail guide covers enabling IMAP where the option exists, Workspace admin restrictions, the same app password used for sending, saving and Test reply detection. The INBOX-only/mail-rule/spam limit is explicit.

The new `email-settings` `test_imap` action logs in with the caller's saved credentials, opens INBOX without fetching messages, quietly baselines a new mailbox and records health. It returns only fixed connected/wrong-password/disabled/cannot-reach/check-failed messages. Saving presets repairs older Gmail settings with no IMAP host; changing the mailbox resets its watermark. Existing manual SMTP test remains separate.

## Decisions, schema and local dependency setup

- Additional names left to the builder: `reply_alerts_after`, `preview`, `thread_references`, `attachment_count`, `opt_out_suspected`, `handled_at`, `ai_draft_log_id`, `email_logs.reply_id`, `reply_alert_recipients` and `reply_mark_handled`.
- Scan spans contain at most 50 UIDs. MIME source has a one-megabyte ceiling; oversized/undecodable messages fail the mailbox safely and retain the failed UID for retry. Admitted decoded text is complete. Preview is 200 characters; AI context retains the previous 5,000-character bound. No existing usage cap or reserve behavior changed.
- The release cutoff starts at migration time. A reviewed rollout must coordinate the first new cron invocation with function deployment; do not leave the old handler serving the new schedule during an extended deployment gap.
- Post-save effects are independently guarded and best effort, as specified. There is no new durable outbox: a post-save effect that fails is logged, later effects continue, and a duplicate reply does not replay notes/drafts/alerts. Existing bounce-counter concurrency was not redesigned.
- Timed-out optional AI work may finish upstream, but it cannot subsequently write a late draft through the timed-out race. No provider was called in local verification.
- Recent inbox rows and notification previews are bounded batches; unread batches remain accessible as reads refresh the queue. Exact unread count comes from the server. This is not an unlimited history export.
- Existing stored replies are untouched and quiet, including legacy raw-MIME bodies without Message-ID. Those older replies cannot use the new threaded answer flow; the UI points to the user's inbox.
- The approved no-email decision and the brief supersede the spec's leftover phrase “summary-email wording”; no summary email was built. No other unresolved Kevin-only product decision was invented.
- Expanded edge checking exposed a pre-existing generic `ReturnType<typeof createClient>` mismatch in `parse-session-notes`; an explicit `SupabaseClient` annotation fixes it without changing runtime logic or RLS.

Root/frontend package manifests are unchanged. `postal-mime@2.4.3` is the only new application dependency and exists only in the edge graph. The existing ImapFlow dependency and PostalMime were installed into ignored local scratch for real runtime fixtures/upstream type declarations. On a fresh checkout, after `npm ci`, bootstrap them before MIME tests/edge checking:

```powershell
npm install --prefix .superpowers/reply-edge-deps --no-save --ignore-scripts --no-audit --no-fund postal-mime@2.4.3 imapflow@1
```

The edge script fails with this instruction when declarations are absent; it does not fabricate PostalMime types or download packages itself. Vite aliases support local tests, while frontend source imports no MIME/IMAP runtime module.

## Tests and gates

Baseline after the authorised rebase: **163 files / 2,501 tests**. Final: **176 files / 2,580 tests**, an increase of **13 files / 79 tests**.

Tests were written before their implementations. Initial red cases covered missing rules/entrypoints, mailbox retry-independent reply guards, threading passthrough, stage enumeration/funnel behavior, analytics FK ambiguity, pre-release silence, safe SMTP errors, full text retention and older unread loading. Added coverage exercises actual multipart/quoted-printable parsing, injected mailbox/database polling, forged/other-mailbox rejection, unique reply/alert effects, partial effect failures, JWT/membership/view checks, fixed-error mailbox tests, final SMTP headers, counts/banner/popup baseline and status rendering. Mail, database, authentication and model effects were faked; no real message was sent.

| Gate | Final result |
|---|---|
| `npx tsc --noEmit` | PASS, 0 diagnostics |
| `npx vitest run` | PASS, **176 files / 2,580 tests / 0 failures** |
| `npm run build` | PASS, **2,915 modules**; existing chunk-size warning above 500 kB remains |
| `node scripts/places-edge-typecheck.mjs` | PASS, **24 entrypoints**, including every affected deployment entrypoint |
| `git diff --check` and change-range whitespace | PASS, 0 whitespace errors |

Full suite/build used only `VITE_SUPABASE_URL=http://127.0.0.1:54321` and `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. The initial full run exposed the old eight-stage analytics expectation; it was updated for Replied, with a real new funnel regression. The expanded edge check's generic mismatch is fixed. There are no unresolved local gate failures. Failure-path tests intentionally emit fixed context-only log lines.

## Files changed

There are **70 changed files including this report**, relative to the rebased brief:

- Shared edge code: `supabase/functions/_shared/ai.ts`, `mailboxTest.ts`, `replyAccess.ts`, `replyDraft.ts`, `replyImap.ts`, `replyPolling.ts`, `replyRules.ts`, `sendLeadEmail.ts`, `sequenceRecipients.ts`, `smtp.ts`.
- Edge entrypoints: `supabase/functions/check-replies/index.ts`, `check-sequences/index.ts`, `draft-reply/index.ts`, `email-settings/index.ts`, `parse-session-notes/index.ts`, `send-email/index.ts`.
- SQL: `supabase/migrations/069_reply_alerts.sql`, `supabase/audits/069_reply_alerts.sql`.
- Email components: `src/components/emails/EmailComposer.tsx`, `LeadReplies.tsx`, `RepliesPanel.tsx`, `ReplyAlertParts.tsx`, `ReplyDetail.tsx`.
- Other components: `src/components/layout/AppShell.tsx`, `MobileNav.tsx`, `Sidebar.tsx`; `src/components/pipeline/stageStyles.ts`; `src/components/settings/DesktopNotificationsCard.tsx`, `MailboxStatus.tsx`, `MailboxStatusView.tsx`.
- Hooks: `src/hooks/useAnalytics.ts`, `useEmailSettings.ts`, `useReplies.ts`, `useReplyAlerts.tsx`, `useReplyDesktopNotifications.ts`.
- Frontend rules/types/styles: `src/lib/analytics.ts`, `dreamAgentActions.ts`, `replies.ts`, `replyAlertsView.ts`, `utils.ts`; `src/types/index.ts`; `src/index.css`.
- Pages: `src/pages/EmailConfig.tsx`, `EmailsHub.tsx`, `LeadDetailPage.tsx`, `Settings.tsx`.
- Tests/fixture helper under `src/lib/`: `analytics.test.ts`, `utils.test.ts`, `mailboxTest.test.js`, `replyAccess.test.js`, `replyAlertsView.test.ts`, `replyAnalytics.test.js`, `replyBanner.test.ts`, `replyEndpoints.test.js`, `replyInboxLoading.test.js`, `replyMime.test.js`, `replyPolling.test.js`, `replyRules.test.ts`, `replySending.test.js`, `replySmtp.test.js`, `replyStatusView.test.ts`, `replyTestDatabase.js`.
- Tooling: `scripts/places-edge-typecheck.mjs`, `vite.config.ts`.
- Documentation: `AGENTS.md`, `CLAUDE.md`, `docs/AUTOMATIONS.md`, `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, this report.

## Audit, verification limits and rollout handoff

**Migration 069 and both audit blocks are unexecuted.** The audit's first block is read-only and suitable only for separately authorised production assertions. Its second block creates throwaway auth users and fixtures and is strictly for a disposable local database. Each ends with a deliberate rollback exception. No production auth user was created.

Not verified: Deno runtime/npm resolution; actual IMAP servers, UID lifecycle/server failures and MIME variants beyond fixtures; actual SMTP threading in Gmail/Outlook; Vault and org AI keys/provider behavior; browser interactions, phone widths, focus/keyboard, rendered themes or real desktop popups; actual migration/RLS/grants/FK relationships/realtime/cron; live runs and deployment. Static rendering and the local edge shim do not prove those behaviors. Effects are not claimed independently reviewed. The underlying mailbox UIDVALIDITY reset lifecycle was not redesigned in this build.

Exact import-based edge deployment manifest for **later review and separate authorisation only**:

1. `check-replies`
2. `draft-reply` — new
3. `send-email`
4. `email-settings`
5. `run-selected-autopilot`
6. `check-sequences`
7. `generate-email`
8. `draft-linkedin-message`
9. `parse-csv-leads`
10. `parse-notes`
11. `parse-session-notes`
12. `pipeline-shares`
13. `run-deep-find`
14. `find-decision-makers`
15. `suggest-sequence`

The longer list follows changed shared AI stage prompts, system-note rules and SMTP imports, including transitive consumers; it is not limited to entrypoint files edited directly. All fifteen are covered by the 24-entrypoint local shim. The new stage's browser bundle also needs the normal reviewed frontend publication.

Safe order after Claude's review and Kevin's separate authorisation: **migration first, then affected functions, then frontend**. Run only the read-only audit block on production if separately approved. Verify inherited readiness prerequisites, including migration 065 status, before promoting this branch's shared baseline; that work is not newly authorised here. Coordinate the five-minute cron with function deployment, then check a controlled mailbox, one-off and sequence replies, visibility/read state, opt-out warning, a manually reviewed threaded answer and both browser themes/mobile/popups.

Next action: Claude reads this report and reviews `0dac5a8..421e4f8`, including the unapplied SQL/audit and documented limits. Builder stops here. No background jobs remain. Ignored `dist/`, `.superpowers/` logs and local dependency scratch files remain outside commits.
