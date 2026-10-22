# Dreamlabs Sales: to-do list

Last updated 2026-10-14. Ask for any item by number or name.

## A. Urgent items: BUILT and live 2026-10-12 (contacts, known person, post-send updates). Still need your real-world test.

1. **Known decision-maker input.** An optional step when finding decision makers: type the full name and position of a person you already know (example: Andrea Manning, Office Manager at HOK), and the app looks for or stores that specific person, including an email you already have (andrea.manning@hok.com).
2. **Edit / add contact details per person from notes and Dream Agent.** Add or change extra email addresses and assign each to a specific person or to the company's general inbox (example: Andrea's own address plus london@hok.com for reception). Today, asking Dream Agent to update the lead's records says it cannot edit anything.
3. **Sent emails should update the platform and follow the sequence.** After emails waiting for review are released, the lead's sequence position, next step and follow-up date should change. When writing an email for a lead already in a sequence, the template picker should suggest (or be limited to) that sequence's templates.

### New follow-ups from the contacts / post-send build

- A1. DONE 2026-10-12: migration 052 applied.
- A2. Test: add Andrea Manning + london@hok.com as contacts, send one email to each, confirm the lead note, sequence step and follow-up date update.
- A3. Store the step number on `email_logs` (replaces the time heuristic) and honour blocklists in check-sequences / the send path.
- A4. `pickRecipient` should honour `include_in_sequences`; defer `next_send_at` when enrolling from a suggestion.
- A5. The note limit is applied before the system-note filter, so leads with many system notes feed the AI fewer than 3-5 notes.

### Wider person lookup (built 2026-10-12, not yet deployed)

- W1. Test: Love Living (add Max Whatley and John Sipple) and HOK (Andrea Manning). Check each step line in the result, that a saved found email has follow-ups switched off, and that "Use this" on a suggestion fills the person's email.
- W2. Consider an Apollo plan upgrade later: the free plan refuses people/match, so Apollo has found nobody so far.
- W3. Consider the same wider net (company list, pattern, website, web search) for the generic "Find decision maker" search.
- W4. Watch Hunter credits: a company list of up to 100 people may cost several credits per lookup.

### Deep find (built 2026-10-12, not yet applied or deployed)

- D1. Order: apply 056, redeploy `find-decision-makers`, deploy `run-deep-find` (new, `verify_jwt = false`, check its CRON_SECRET equals the vault `cron_secret`), then apply 057 (its cron starts ticking at once), then push the client.
- D2. Retest on Love Living: "Add person" for John Sipple with no typed domain should find loveliving.uk by itself (step "Company domains"). Then run "Deep find this lead": check the people added (source shown, follow-ups off), the company domains line, and the names to check.
- D3. Retest on HOK (Andrea Manning) the same way.
- D4. Consider running Deep find automatically on new leads, or as a step inside the selected-leads autopilot.
- D5. Apollo upgrade note: the free plan refuses people/match, so Deep find does not use Apollo at all. Revisit after an upgrade.
- D6. People named only by the web search or the website are listed as "To check" and never saved (no honest contact source exists for them). Consider a one-click "Add as contact" that saves them as your own manual contact.
- D7. Watch Hunter credits: defaults are 60 Hunter credits and 25 AI calls per run (editable, max 500 / 200). Compare `hunter_used` with the Hunter dashboard after the first run.
- D8. Not fixed (review notes only): Gemini error messages still carry up to 300 characters of provider text inside the thrown error (never logged or returned by Deep find); migration 057 is not re-runnable (apply once, in one transaction).

### Deep find v2 (built 2026-10-13, not yet applied or deployed)

- V1. Apply 058 after 056 and 057, then redeploy `find-decision-makers` and deploy `run-deep-find`.
- V2. Retest Love Living with the real town typed on the lead (Hackney): expect the right Companies House company (or a choice of 3), Max Whatley added as an officer, loveliving.uk confirmed (MX + a known person on Hunter's list), lovelivinguk.co.uk NOT saved, and the website flagged as possibly another company. Try "Not their domain" on lovelivingmanagement.com.
- V3. Retest HOK (Andrea Manning) the same way.
- V4. Check the Companies House search item fields (`title`, `company_number`, `company_status`, `address.postal_code`, `address_snippet`), Hunter email-finder by company (`data.email`, `data.score`) and the Cloudflare DoH answer shape against real replies on the first run.
- V5. Apollo: a paid plan would add people/match and phone numbers; the free plan refuses it, so Deep find does not use Apollo.
- V6. Consider auto-running Deep find on new leads (or inside the selected-leads autopilot) once a few manual runs look right.

### Email formatting (built 2026-10-12, not yet deployed)

- F1. Test: send a formatted test email (bold, bullets, a heading, a link, plus the unsubscribe line) to your own address and check it in Gmail on desktop AND on a phone. Also send one with no formatting and confirm it still arrives as plain text.
- F2. Optional later: italic and numbered lists (out of scope for the first version).

## E. Lookup tools (agreed 2026-10-14, see docs/LOOKUP-TOOLS-PLAN.md; NOT built, build only when Kevin says)

- E1. Check outbound port 25 on the Hostinger KVM 2 VPS (needed for Reacher email verification).
- E2. Worker stack on the VPS: omkarcloud website-email-contact-scraper + reacherhq/check-if-email-exists behind a wrapper with an SSRF guard, secret header and rate limits.
- E3. Deep find calls the worker (scraper, pattern guess + verify) and Firecrawl (team page) after our own scanner; provenance and confidence label on every found address.
- E4. Footer company-number match against Companies House candidates (auto-pick), free and small.
- E5. Per-org monthly Firecrawl credit cap; Hunter allowance shown in the confirm dialog (built).
- E5b. Per-org keys/quotas for the new tools: providers `firecrawl` (BYO key, no global fallback) and `lookup_worker` (URL+secret, default to Kevin's VPS for his own orgs only), per-org worker quotas, per-provider allowance shown in the Deep find confirm dialog.
- E6. Personal-data safeguards: source+date on every contact, sole-trader flag, delete-on-request path.

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
29. Saudi Arabia and UAE markets (deferred by Kevin 2026-10-22). Draft spec: `docs/superpowers/specs/2026-10-22-gulf-markets-design.md`. When resumed, Claude asks Kevin kickoff questions first (sectors, cities, first org, register source). Build after platform owners and phone numbers.
30. WhatsApp outreach to decision makers (requested 2026-10-22, spec not yet written; follows the phone numbers spec). Needs kickoff on Meta rules (opt-in, approved templates), review-before-send and which org goes first.
