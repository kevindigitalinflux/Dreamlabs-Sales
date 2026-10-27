# Build brief: reply alerts, Replies tab and mailbox status

You are Codex, the builder. Claude is the architect and reviewer. Kevin directs (approved the design on 2026-10-27).

Work only in this worktree (`C:/Users/kevin/Projects/dreamlabs-sales-replies`, branch `codex/reply-alerts`). Do not touch any other checkout.

## Before you start

1. Make sure `origin/main` includes the readiness work (Kevin confirms this to you in the launch message). Then rebase: `git fetch origin && git rebase origin/main`. If the rebase conflicts in `src/types/index.ts` or `supabase/functions/_shared/sendLeadEmail.ts`, keep both sides' changes. Run `npm ci` if `node_modules` is missing.
2. Read `CLAUDE.md`, `AGENTS.md`, and then the binding spec in full: `docs/superpowers/specs/2026-10-27-reply-alerts-design.md`. The spec is approved. Where this brief and the spec disagree, stop and record it in the report.
3. Record the baseline test count (files and tests) before you change anything.

## Scope

Build everything in the spec: sections 1 to 5 (faster complete detection, what a reply does, alerts, Replies tab and answering, mailbox status and guided setup), migration `069`, the audit, the `draft-reply` edge function, tests and docs.

Kevin's two changes are binding:
- There is **no new page**. Replies live in a new `replies` tab of `src/pages/EmailsHub.tsx` (`/emails?tab=replies`). The unread badge goes on the Emails item in the Sidebar and mobile nav. The banner and desktop popups link to that tab.
- **No email notifications** of any kind. Do not build a notification email, an `emailed_at` column or a per-user email switch.

## Order of work (small commits, tests first)

1. **Pure logic with failing tests first**: auto-reply and bounce detection with realistic header sets, quote stripping and preview, opt-out phrase detection, the forward-only stage rule, exclusion of the "Reply received" note from AI context (same way as `isSequenceSystemNote`), London date for the follow-up, recipient selection (sender plus admins who can see the lead, de-duplicated), threading headers.
2. **Migration `069_reply_alerts.sql` plus rollback audit `supabase/audits/069_reply_alerts.sql`**: columns, `reply_notifications` table, own-row RLS, realtime publication, `replied` stage in the CHECK constraint (read the live constraint definition from the earlier migrations first, never guess it), tightened `email_replies` SELECT, cron change (5 minutes, replacing `check-replies-daily`). Additive and reversible where possible. Do not weaken any RLS, grant or guard. Keep the audit in two clearly separated blocks like `supabase/audits/068_phone_metadata.sql`: read-only assertions that are safe on production, and a fixture block (throwaway auth users) for a disposable local database only.
3. **`check-replies`**: UID-range fetch, `npm:postal-mime` parsing, match to any sent email, real replies only, unique `message_id` idempotence, mailbox health columns, effects (save reply, pause enrolment, stage, follow-up date, note, notifications). Never auto-opt-out. Do not change the existing auto-draft behaviour.
4. **`draft-reply`** edge function (user JWT, membership plus `can_view_lead`, org Anthropic key, never sends) and `sendLeadEmail` `inReplyTo`/`references`.
5. **Frontend**: Replies tab, Sidebar and mobile badge, banner, desktop popup via the existing opt-in (business name and first line only), `EmailComposer` answer flow, mailbox status and guided Gmail IMAP setup in `EmailConfig.tsx`, `test_imap` action on `email-settings`, warnings from section 5. Every realtime hook uses a per-instance channel name.
6. **Docs**: `docs/AUTOMATIONS.md`, `docs/HANDOFF.md`, `docs/NEXT-STEPS.md`, `CLAUDE.md` status, and `docs/REPLY-ALERTS-BUILD-REPORT.md`.

## Constraints

- TDD: failing test first, then implementation.
- Never use a bare `catch {}`; log with context. Log nothing that contains reply text, email addresses or secrets.
- Review-before-send stays. `draft-reply` and the answer flow never send automatically; the user reads, edits and clicks Send.
- Do not change existing RLS, grants, guard triggers, usage caps or reserve behaviour, except the `email_replies` SELECT tightening the spec asks for. Check `useAnalytics` reply-rate still works afterwards.
- Do not call any external service. Do not push, merge, deploy, apply migrations, or write to any remote or to Supabase. No real credentials, mailboxes, emails or messages. Mail and IMAP are faked in tests.
- Dummy env only for local runs: `VITE_SUPABASE_URL=http://127.0.0.1:54321`, `VITE_SUPABASE_ANON_KEY=local-test-placeholder`. The only new dependency allowed is `npm:postal-mime` in the edge function import graph (not the frontend bundle). If it cannot be made to type-check with `scripts/places-edge-typecheck.mjs`, stop and report.
- Plain, short, jargon-free user text, UK English. Components under about 150 lines where practical. Accessible (text not colour alone, keyboard, works at phone width, both themes).
- If something in the spec needs a decision only Kevin can make, stop that item and record it in the report. Do not invent.
- Stage explicit file paths only; never commit CRLF/LF noise. Small commits with `git -c core.hooksPath=NUL commit`, each ending with `Co-Authored-By: Codex <noreply@openai.com>`.

## Gates

`npx tsc --noEmit`, `npx vitest run` (with the dummy env), `npm run build`, `git diff --check`, and `node scripts/places-edge-typecheck.mjs` (add `check-replies`, `draft-reply`, `send-email`, `email-settings` to its entrypoints if missing). Report exact counts against the baseline.

## Deliver

`docs/REPLY-ALERTS-BUILD-REPORT.md`: what was built per spec section, files changed, gate results, decisions where the spec was silent, what was not verified (Deno runtime, real IMAP, browser, phone width, desktop popups, the unapplied migration, live runs), and the exact edge functions that need deploying (expected: `check-replies`, `draft-reply` new, `send-email`, `email-settings`, `run-selected-autopilot`, plus anything else that imports changed shared code). State the safe order: migration first, then functions, then frontend. Then stop. Claude reviews before any merge.
