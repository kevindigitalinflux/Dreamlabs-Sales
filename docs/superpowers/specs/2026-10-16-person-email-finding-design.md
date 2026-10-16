# Deep find: find the email of people it found — Design

Date: 2026-10-16. Author: Claude (architect). Trigger: Kevin's UX Tree test (Dublin): Deep find found Valentina Antunovic (founder) but no email. Causes seen in the result: (1) no email FORMAT known for uxtree.com (only privacy@ and gdpr@ were scraped), so no built address; (2) Hunter used up; (3) "Looking up Valentina Antunovic, Web search: ran out of time" (the per-lead budget was spent by the browser scraper and Firecrawl before the person lookup); (4) the "None of these / not a UK company" control is too easy to miss. Builder: Codex (`gpt-6.1-sol`), reviewer: Claude. Follows `docs/LOOKUP-TOOLS-PLAN.md` steps 6-7 (candidate addresses for each person, verified with the free checker).

## Rules (binding)
Review-before-send. Only a checker result `valid` may be filled automatically, and only into a BLANK email of an existing contact (existing rule); `risky`/`unverifiable`/catch-all are never filled and never called valid. Nothing is added to sequences. Worker calls only through `workerClient` (reserve first, refund at most once, fail closed, a kind stops after limit/busy/unreachable). Max 6 email checks per lead per run today (`MAX_VERIFY_PER_LEAD`); the worker allows 5 checks per mail domain per minute. Plain-English step lines, no raw provider text, no secrets in logs.

## Part A — Guess and verify addresses for known people
- Trigger: a person we have (contact on the lead, officer, named on site/web) with a first and last name, no email, on a CONFIRMED domain, when no email format could be inferred (or in addition to the format-based guess if one exists, but never twice for the same address).
- Candidate patterns, in this likelihood order, at most 5 per person per domain: `first.last`, `first`, `flast`, `firstlast`, `first_last` (lowercase ASCII, names normalised: strip accents, drop apostrophes/hyphens/spaces sensibly; existing helpers `nameVariants.ts`/`domainPattern.ts` first, reuse them).
- Verify each with the free checker one at a time, stop for that person at the first `valid`. `valid` -> fill the contact's blank email (existing `fillBlanks` path) with label "Guessed from common formats and confirmed by our email checker, check it". `invalid` -> next candidate. `risky`/`unverifiable` -> do not fill; if the FIRST result for a domain says catch-all (reason `catch_all`) treat the whole domain as catch-all: stop checking that domain for all people (saves units and avoids the per-domain throttle) and offer only the top two candidates as suggestions labelled "Guess, the mail server accepts any address so it cannot be confirmed".
- Budget: share the existing per-lead check cap; raise `MAX_VERIFY_PER_LEAD` only if needed to cover 2 people x 3 candidates (record the choice); respect the worker's 5-per-domain-per-minute limit (do not exceed 5 checks on one domain in one run).
- Pure, tested module (import-free): candidate generation (normalisation edge cases: accents, hyphens, apostrophes, middle names, single-letter names, Irish names like O'Brien), ordering, catch-all domain tracking, the decision to stop. Integration in `deepFind.ts` next to the existing built-address verification (step 1c) with the `verifyAction` rules unchanged.

## Part B — Person lookups get time priority
- In `deepFind.ts` the optional steps (browser scrape, Firecrawl) must not starve the known-person lookups: when there are known people without emails, reserve a floor for the people steps (suggested 25 s of the per-lead budget, `PEOPLE_RESERVE_MS`) and admit the browser scrape / Firecrawl only if `left() - PEOPLE_RESERVE_MS` still satisfies their own admission rules (`scrapeTimeoutFor` etc.). Put the arithmetic in a pure function with tests. Do not change the per-lead budget unless needed; if you do, keep within the edge function's 150 s wall (`WALL_BUDGET_MS` 130 s) and record it in HANDOFF.md.
- When a person lookup is skipped or times out, say why in plain words in that person's line ("Not enough time left in this run, try Deep find again") instead of only "ran out of time".

## Part C — Say what happened for each person without an email
- After the run, for each known person still without an email add one plain line in the result: what was tried and why it did not work, e.g. "Valentina Antunovic: no email found. Tried 5 common formats on uxtree.com (none confirmed), Hunter is used up this month." Keep it short, no secrets, fixed sentences.

## Part D — Make "None of these / not a UK company" a call to action
- In the company-choice panel (`DeepFindCompanyChoice.tsx`), restyle the "None of these / not a UK company" control as a primary-looking button at the TOP of the panel (above the candidate list), strong contrast (use the app's primary/CTA button classes and tokens, not muted link text), with a short plain line under the heading such as "Not a UK company, or your company is not listed?". Keep accessibility (focus, `aria-expanded`, contrast 4.5:1 in both themes, phone width) and the existing behaviour of the small country select.

## Out of scope
Irish CRO lookup, Hunter, paid verification, automatic sequence enrolment, changing quotas.

## Tests and delivery
Unit tests for every pure helper; regression tests for flows with an existing format, with catch-all domains, with the worker off (no guesses attempted, one plain line). Branch `codex/person-email-finding`; gates `rtk err npx tsc --noEmit`, `rtk test npx vitest run`, `rtk err npm run build`; HANDOFF.md section; CLAUDE.md entry. No migration expected; if one appears, stop and record the question. Claude reviews; deploy `run-deep-find`; live check on the UX Tree lead (Valentina) and the company-choice button.
