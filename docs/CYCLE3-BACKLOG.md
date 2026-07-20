# Cycle-3 Backlog

From the cycle-2 final whole-branch review (2026-07-19, verdict READY). Ordered by value.
Items here are accepted debt — none block current use. The scraper module (SPEC §5/§6) is
cycle 3's headline feature; schedule these around it.

1. **Enrollment/cron integrity batch** — make check-sequences' draft-insert + enrollment-advance
   a single transactional RPC; add a partial unique index
   `sequence_enrollments(lead_id) WHERE status IN ('active','paused')` to prevent duplicate
   active enrollments (double-click / two devices).
2. **Dead code sweep** — delete `SequencesSection` (LeadDetailSections.tsx), remove the unused
   `draftCount` state + its per-load count query from `useDashboardStats`, refresh stale
   "arrives in cycle 2" copy in `EmailLogSection` empty state and the Settings.tsx docstring.
3. **Edge-function input-hardening pass (one PR)** — try/catch `req.json()` in all 5 functions;
   smtp_port range check; SSRF guard on custom SMTP (deny private/reserved/link-local/metadata
   IP ranges after DNS resolution, allowlist ports 25/465/587/2525); check the `is_verified`
   update result in email-settings; lead visibility check (caller-JWT) before writing `lead_id`
   in send-email; move the Gemini key from `?key=` query param to the `x-goog-api-key` header.
4. **Gemini payload narrowing** — send a field subset (drop id/raw_lead_id/kanban_position/
   timestamps/phone/address) instead of the full lead row; add "keep in sync" markers on the
   stage/package enum lists inside `_shared/ai.ts` prompts (third sync surface).
   **Kevin decision needed:** Gemini free-tier terms allow Google to train on submitted content
   (lead PII + deal values). Paid tier (~pennies at this volume) removes that.
5. **UX/a11y batch** — keyboard-accessible row expand (EmailLogList + ListTable together);
   CSV "Sent by" name instead of UUID; confirm-before-discard on review-queue drafts;
   reset composer state on close (LeadPanel/LeadDetailPage keep it mounted); surface
   parse-notes apply failures instead of silently closing; warn that re-saving email settings
   resets Verified; PointerSensor distance-6 activation in SequenceBuilder (match Kanban).
6. **Ops/deploy checklist** — set `APP_ORIGINS` function secret before the Cloudflare Pages
   deploy (CORS breaks otherwise); note check-sequences per-run volume ceiling (7s × due
   enrollments vs edge wall clock) in AUTOMATIONS.md; delete the stray cancelled test
   enrollment on Brightside Dental; consider persisting cron skip-reasons for visibility.
7. **Cosmetic** — rename seeded templates if the "(7 days)"-style names mislead against actual
   sequence delays; sequence steps limited to the 5 default templates (allow custom templates
   as steps if Kevin wants it).
