# Build brief: learn email formats from bounces and replies

Builder: Codex. Reviewer: Claude. Director: Kevin. Roles unchanged. Start from `origin/main` in a fresh worktree after the registry brand-match fix round is reviewed and merged (that round touches `deepFind.ts`; one writer per checkout).

## Why
SMTP checks cannot confirm Microsoft 365 or other hosted mailboxes (probe 2026-11-04: `info@fold7.com` and `hello@arup.com` stay `unverifiable / unknown`). The real send outcome is the best proof we get, and we already read it and throw it away:
- `supabase/functions/_shared/replyRules.ts` `automaticMail(...)` classifies bounces (`mailer-daemon`, `postmaster`, delivery-status content type).
- `supabase/functions/_shared/replyPolling.ts` only counts a bounce (`recordBounce` raises `autopilot_runs.bounce_count`, cancels the run at 10). It never records WHICH address bounced.
- A real reply from an address proves that address works. Today nothing stores that as email evidence.

## Goal
1. A hard bounce marks that exact address invalid for that org, and the engine never suggests or sends to it again.
2. A real (human) reply marks the sender address confirmed.
3. Both outcomes feed the domain's format knowledge so later guesses at that domain rank better ("Pattern-supported" tier from fix round 1, Part 4).

## Scope (verify each fact in code first; do not assume)
1. Find where bounce DSNs are parsed (`replyPolling.ts`, `check-replies/index.ts`). Report whether the failed recipient is available (`Final-Recipient`, `Original-Recipient`, `X-Failed-Recipients` headers or the DSN body). Do not store the unrelated message body.
2. Hard vs soft: only a permanent failure (DSN status `5.1.1`, `5.1.10`, `550 5.1.1`, "user unknown", "mailbox not found") counts. Mailbox full, greylisting, `4.x.x`, auto-replies and out-of-office never mark an address invalid.
3. Storage: propose ONE new table `email_outcomes` (org_id, address lowercased, domain, outcome `bounced_hard | replied`, source message id or UID, seen_at; unique on org_id + address + outcome). RLS on, org-membership policy like the other org tables, grants matching existing tables. No message bodies. This needs a migration, so write the SQL in the report and STOP for Kevin's approval before applying anything; local tests only.
4. Use in the engine (`deepFind.ts`, shared email helpers):
   - Before checking or suggesting an address, look up `email_outcomes` for the org. `bounced_hard` means skip with the plain reason "This address bounced before." `replied` means treat as verified with the reason "This address has replied before."
   - Feed `replied` addresses and the lead's format into `inferDomainPattern` / `formatEvidence` as published-source evidence (a reply is stronger than a scrape).
   - Do not change check allowances, effort presets or worker files.
5. Sequence safety: a hard bounce on a lead's address removes that address from any active sequence for that lead (reuse the existing suppression path; find it first), and the rep sees a plain note on the lead.
6. Privacy: addresses are personal data. Keep org-scoped, no cross-org sharing, deletable with the lead/org. State this in the report.

## Tests (first)
- DSN fixtures: hard bounce with each header form; soft bounce; out-of-office; mailbox full; multiple recipients in one DSN.
- A real reply records `replied`; an auto-reply does not.
- Engine: bounced address skipped with the plain reason; replied address verified; unaffected addresses unchanged.
- Org isolation (RLS or query-level) test.

## Constraints
TDD. No push, merge, deploy, Supabase writes or secrets. Do not apply the migration. Stage explicit paths. Commits with `git -c core.hooksPath=NUL commit` ending `Co-Authored-By: Codex <noreply@openai.com>`. Gates: `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`.

## Deliver
`docs/EMAIL-OUTCOME-LEARNING-BUILD-REPORT.md`: what the DSN parser can and cannot extract (with real header examples, addresses anonymised), the migration SQL, changed files, gate counts, anything not verified, deploy list (`check-replies` plus engine functions importing changed shared files). Then stop. Claude reviews before any merge.

# Scope update, 2026-11-05 (Kevin): bounces are hurting now, so this brief grows into three parts, built in this order
Evidence (Claude, production read-only): on 2026-11-05 the Mr Brush & Co org sent 120 emails to 60 domains; 97 went to the lead's own saved email (scraped or Places address) and 26 to contacts (Hunter 13, Companies House 6, manual 7). Kevin reports many bounced as "address not real". Bounces are classified in `replyRules.automaticMail` but only counted (`recordBounce`), so nothing learns from them, and sequences can send follow-up steps to an address that already bounced. The shared lookup worker's email check only runs inside Deep find; a lead email that never went through Deep find is sent unchecked.

Branch: in `C:/Users/kevin/Projects/dreamlabs-sales-accuracy` run `git switch -c codex/email-outcome-learning` from the current `main` (the checkout is clean). Same constraints as above: tests first, one commit per item, no push, merge, deploy or secrets, do not apply the migration, stage explicit paths, commits `git -c core.hooksPath=NUL commit`, ending `Co-Authored-By: Codex <noreply@openai.com>`. Stop after each part's report addendum if allowance runs low.

## Part A: learn from bounces and replies (the original brief above, plus these additions)
1. Immediate suppression: when a hard bounce is recorded, stop every active sequence enrolment for that lead whose next recipient is the bounced address (reuse the existing pause/cancel path; find it first) and add a plain note on the lead ("Email to X bounced: address does not exist").
2. Backfill: one-off, idempotent routine (a function action or a script run by Kevin) that reads the connected mailbox's bounce messages from the last 30 days using the same parser and writes `email_outcomes` rows, so the 2026-11-05 bounces are learned at once. It must be safe to run twice (unique constraint), cap the messages read, never store message bodies, and report counts (bounces found, recipients extracted, unmatched).
3. Per-domain signal: a domain with 3 or more distinct hard bounces in 14 days gets a plain warning on its leads' contacts ("Several addresses at this domain bounced: check the format"), stored as a derived read, no new table beyond `email_outcomes`.
4. Everything from the first brief stays (hard vs soft rules, `email_outcomes` table and RLS, engine use, privacy).

## Part B: check before sending (no migration)
1. Before `send-email` sends to any address that has no recent check result, run the lookup worker's `/verify-email` through the existing `workerClient` and gate (`reserveUsage` first, refund rules unchanged). Cache the last result per org + address for 14 days in a small in-run map plus, if a table is needed, list the exact table in the report and do NOT create it. Prefer reusing `email_outcomes` with an extra outcome value `checked_invalid | checked_valid | checked_unverifiable` if you propose it in the Part A migration SQL (one migration, Kevin approves once).
2. Rule: `invalid` blocks the send with a plain reason shown in the review queue and on release ("Our checker says this address does not exist"); `valid` sends; `unverifiable` (catch-all, hosted mail, timeout, checker down) sends but the review queue labels it "Not confirmed" so the rep knows. Bulk release shows counts: sent, blocked, not confirmed. A rep can override a block per row with an explicit confirm.
3. Free pre-checks, no worker needed: syntax, a domain with no MX record (DNS-over-HTTPS helper already exists) is invalid, obvious typos of common free domains are flagged not fixed.
4. Quota: a 120-email release needs 120 checks; the live allowance is now 600 per org per day and 1200 worker-wide (Claude raised the `usage_resources` row on 2026-11-05). Mirror these numbers in `usageRules.ts`. If the allowance is exhausted, do not block sending: label "Not checked: daily check allowance reached".
5. Tests: invalid blocks, valid sends, unverifiable labelled, no-MX invalid, allowance exhausted, worker down, bulk summary, override.

## Part C: stronger verifier (no migration)
1. Caps (Kevin approved a reasonable raise): `MAX_VERIFY_PER_LEAD` 6 to 10, per-domain 5 to 8 in `GuessChecks.remaining`/`canCheck`, `EFFORT_DAILY_LIMITS.checks` 150 to 600, and `usageRules.ts` worker_verify 150/300 to 600/1200. The worker's own 5 checks per minute per domain and the sliding window in the run gate stay. Update tests and the confirm-dialog text that quotes allowances.
2. Greylisting and unknown retry: an `unverifiable/unknown` or `timeout` answer from a non-hosted domain is retried once after at least 60 s inside the same lead's remaining time (the sliding window already spaces domain starts), counted as one check, never retried for catch-all or provider-blocks answers.
3. Role mailbox honesty: `info@`, `hello@`, `contact@`, `office@`, `enquiries@`, `admin@`, `sales@` on a catch-all or hosted domain are labelled "Role address, not confirmed" and are never auto-selected as the lead's primary address by Deep find.
4. Report measured effect: in the fake-worker suite, show before/after counts of addresses that would have been sent unchecked.

## Deliver
`docs/EMAIL-OUTCOME-LEARNING-BUILD-REPORT.md` with, per part: what changed, the migration SQL (one file, not applied), gate counts, what is not verified (live DSN samples, real worker latency), deploy list (`check-replies`, `send-email`, `run-deep-find`, `run-selected-autopilot`, `run-lookup-jobs`, any function importing changed shared files) and the frontend changes. Then stop for Claude's review.
