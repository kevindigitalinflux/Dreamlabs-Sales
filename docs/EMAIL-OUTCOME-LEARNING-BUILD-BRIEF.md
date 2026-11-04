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
