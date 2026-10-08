# Dreamlabs Sales: to-do list

Last updated 2026-10-08. Ask for any item by number or name.

## A. Urgent (flagged by Kevin 2026-10-08, being scoped)

1. **Known decision-maker input.** An optional step when finding decision makers: type the full name and position of a person you already know (example: Andrea Manning, Office Manager at HOK), and the app looks for or stores that specific person, including an email you already have (andrea.manning@hok.com).
2. **Edit / add contact details per person from notes and Dream Agent.** Add or change extra email addresses and assign each to a specific person or to the company's general inbox (example: Andrea's own address plus london@hok.com for reception). Today, asking Dream Agent to update the lead's records says it cannot edit anything.
3. **Sent emails should update the platform and follow the sequence.** After emails waiting for review are released, the lead's sequence position, next step and follow-up date should change. When writing an email for a lead already in a sequence, the template picker should suggest (or be limited to) that sequence's templates.

## B. Testing you need to do (selected-leads autopilot + registry work went live 2026-10-08)

4. **Send one ordinary email from the app to your own address.** Checks the refactored send path and the new "already sent" guard.
5. **Run a small selected-leads autopilot run.** Leads addressed to your own mailboxes, send cap 2, window that includes the current time. Check: emails arrive; notes, stage, sequence enrolment and follow-up date update; a problem lead lands in "Needs your input" while the run continues; replies are detected.
6. **Test the CRO key when Valentina's arrives.** Save it in UX Tree's organization settings as `email:key`, run one Irish search, compare with the assumed response shape (endpoint, login format, field names are unverified in `supabase/functions/_shared/cro.ts`).
7. **Check the Companies House scrape on a UK org** with a real key: officers appear as decision-makers, company contacts are company-only.

## C. Follow-ups from the autopilot build (not urgent)

8. A database blip while checking the sender's mailbox cancels the whole day's run; it should retry instead (`loadSenderMailbox` read/RPC error vs a real "not verified").
9. A parked lead can skip a follow-up step if the daily `check-sequences` job runs before the parked draft is reviewed (it drafts step N and advances; Review and send then advances again).
10. Parked and interrupted autopilot drafts also appear in "Waiting to release" and can be bulk-released without the needs-input context. Filter them out of bulk release.
11. A later run can pick a lead that still has an unsent parked draft from an earlier run. Add a guard.
12. A few older functions return or store network error text that could include an API key in the URL: `parse-icp`, `scrape-google-places` (`scrape_jobs.error_message`), `org-api-settings`.
13. Send cap is per run, not per organization per day.
14. Overlapping tick invocations weaken the 20-second pacing between sends.
15. Step-sent guard undercounts if a discarded sequence draft and a failed advance happen together (long-term fix: store the step number on `email_logs`).
16. Server-side: `send-email` blocks re-sending a `sent` log, but `sendLeadEmail` (engine) has no such guard (not needed today).
17. Creator-can-view-lead is checked at the start of each lead only.
18. `useOrgLeads` stale-response race when switching org; discover `createRun` shows raw unique-violation text; autopilot `started_at` is client-settable (only affects your own run).
19. Mobile nav has no Emails entry (so no needs-input badge on mobile).

## D. Earlier ideas still open

20. Search box inside long dropdowns.
21. Category rename/merge screen.
22. Extend customer profiles (ICPs) to the scraper `icp_params`, CSV import and decision-maker targeting.
23. Bring a completed sequence enrolment back to life from the enrollment section.
24. Restore the Dreamlabs lines in the user memory index (`MEMORY.md`).
25. `text-cyan` and `--color-muted` light-mode contrast.
26. Power Dialer provider wiring and the AI voice agent (phase 2).
27. Remove the temporary `/preview/splash-to-login` route.
28. Pre-launch security items from the 2026-09-22 audit that are still open (leaked-password protection, `_headers`/CSP, rate limiting beyond `unsubscribe`, audit log for admin actions, error monitoring, backup plan).
