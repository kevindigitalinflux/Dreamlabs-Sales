# Worker integration (sub-project C of 3) — Design

Date: 2026-10-14. Status: written, awaiting Kevin's review. Nothing built.

Part of the lookup-worker programme (`docs/LOOKUP-TOOLS-PLAN.md`). Order: A. Usage and quotas (live) -> B. Jobs tracker and notification bar (live) -> **C. Worker integration (this spec)**. Afterwards, as separate pieces (Kevin, 2026-10-14): Firecrawl, per-organisation worker keys, desktop pop-ups.

## Why
The lookup worker at `https://lookup.didreamlabs.com` is live (site scraper, email checker, SSRF-guarded page fetch) and usage limits are in place, but nothing in the app calls it. Deep find still spends Hunter credits to check every email address it builds, and its own page reader finds little on JavaScript-heavy or bot-protected sites. Stage 2 makes "Fill in missing details" and "Find decision maker" background jobs that show in the Jobs tracker.

## Understanding Kevin confirmed (2026-10-14)
1. Two stages, one design. Stage 1: connect the worker and use it inside Deep find. Stage 2: the two buttons become background jobs.
2. Free tools first, Hunter only to fill gaps.
3. Only an email the checker calls **valid** is filled in automatically; everything else stays a labelled suggestion.
4. Hunter's verifier is used only when our checker says **unverifiable** and credits remain.
5. The four organisations share the global worker (limits per organisation from sub-project A). Firecrawl, per-organisation worker keys and desktop pop-ups come after this.

## Out of scope
Firecrawl; per-organisation worker address/secret; desktop pop-ups; changing the worker itself; adding new Autopilot behaviour; automatic addition of any found address to sequences.

## Stage 1: worker inside Deep find

### 1. Worker client (`supabase/functions/_shared/workerClient.ts`, new)
- Functions: `workerScrapeSite(service, orgId, url, mode)`, `workerVerifyEmail(service, orgId, email)`, `workerFetchPage(service, orgId, url)`. Each returns a typed result: `{ ok: true, ... }` or `{ ok: false, failure }` with `failure` one of `not_configured | limit_reached | busy | unreachable | bad_response`. Raw worker or provider text is never returned.
- Order inside each call: read config -> `reserveUsage` (resource `worker_scrape` with 1 unit for `homepage`/`key_pages` and 3 for `deep`, matching migration 059; `worker_verify`; `worker_fetch`) -> request with `x-worker-secret` and a hard timeout (scrape 45 s, verify 20 s, fetch 12 s) -> validate the reply again server side.
- **Refund rule:** `refundUsage` at most once, with the `day` the reserve returned, and only when the worker did no work (not configured after reserving is impossible: config is read first; unreachable, timeout before a reply, HTTP 429/503). A completed call, even one that found nothing, is never refunded.
- **Fail closed:** any error from `reserveUsage` means the step is skipped.
- Config: edge-function secrets `WORKER_URL` and `WORKER_SECRET`. Missing either means `not_configured`, a plain "The lookup worker is not set up" line, and Deep find behaves exactly as today. Kevin sets the secret himself from the VPS `.env` (`supabase secrets set`, typed by Kevin, never pasted in chat).
- Pure rules (mapping worker statuses and HTTP codes to failures, unit costs, URL/host pre-checks, validation of the reply, the "valid only" rule) live in an import-free `workerRules.ts` so they are unit-tested in node, as `usageRules.ts` is.
- Never log the secret or full reply bodies.

### 2. Email checks first at the "built address" step (`deepFind.ts` step 1c)
Today a built address (from the inferred email format) is verified with Hunter (`spend.hunter('verify email format')`, up to 3 per lead). New order per candidate address:
1. `workerVerifyEmail` (up to 6 per lead; per-domain throttling is in the worker).
2. `valid` -> verdict `verified` (fill in the contact's blank email, label "Built from the email format and checked by our email checker").
3. `invalid` -> drop it, as Hunter's `invalid` does today.
4. `risky` or `unverifiable` (including catch-all domains, which are never "valid") -> if a Hunter key and credits remain, ask Hunter as today; otherwise a suggestion labelled by the existing `guessLabel` plus the reason ("the mail server accepts any address, so this cannot be confirmed").
5. Worker failure (`limit_reached`, `busy`, `unreachable`, `not_configured`) -> fall through to Hunter exactly as today, and add one plain problem line.
Result: Hunter credits are only spent when the free checker cannot decide.

### 3. Site scraper where our own page read finds little
- Trigger: a confirmed company domain whose pages (read by `readCompanyPages`) produced no email address and no phone number for that domain, or the page read failed or returned an empty shell. One scrape per lead, mode `key_pages` (cost 1); `deep` only when a user later asks (not in Stage 1).
- Use: scraped emails and phones are accepted only when the address belongs to a confirmed domain of the lead (same rule as `domainEmailsOnPages`); each is stored as a **proposal with its source page and date**, and a person-less address is offered as a company contact, never attached to a named person unless the local part matches a known person through the existing pattern/match rules.
- Existing behaviour is untouched when the worker is off or the page read already found enough.

### 4. Visibility
- The Deep find results show one plain line per worker step, in the same style as the existing step lines: "Checked 3 emails with our own checker (2 valid, 1 could not be confirmed)", "Read the site with the browser scraper: found 2 addresses and 1 phone number", "Email checks were not used: the daily limit for this organisation is reached."
- The usage meter and Settings card from sub-project A already show the counters.
- Provenance (source, date) is stored with each filled or suggested value using the existing fields; if no suitable field exists for a value, the proposal text carries it (decided in the plan from the code).

### 5. Safety and privacy
- Business-context data only; honour opt-outs; no addition to sequences from found or guessed addresses (unchanged).
- Worker output is untrusted: re-validate addresses, cap sizes, ignore anything outside the confirmed domains, never show raw text.
- SSRF: the edge function sends only hosts that already passed `parseSafeWebsiteUrl`; the worker applies its own guard as a second layer.
- Usage always reserved before the call (rule from sub-project A).

## Stage 2: the two buttons as background jobs (own short spec and plan after Stage 1 is live)
- "Fill in missing details" (`enrichOneLead`) and "Find decision maker" (`findAndStoreDecisionMakers`) create a queued job row and return at once; a tick (same engine style as Deep find, claimed rows, wall-clock budget) does the work, using the same worker client and rules.
- One new `JobSource` adapter in the Jobs tracker (append to `JOB_SOURCES`; add its table to `JOB_TABLE` if deletable; its realtime tables must be in the `supabase_realtime` publication). Titles name the leads, as in sub-project B.
- Review-before-send and no-auto-sequence rules unchanged.
- The details (table design, tick, cancellation, limits) are settled in the Stage 2 spec, not here.

## Error handling and edge cases
- Worker down or slow: the step is skipped with a plain line; the rest of Deep find continues; usage refunded only when no work happened.
- Limit reached (organisation or worker-wide): skipped with `refusalLine` wording from `usageRules.ts`.
- Reserve error: skipped (fail closed).
- A reply that fails validation: treated as `bad_response`, nothing stored, no refund (the worker did work).
- Lead budget: worker calls respect the existing per-lead time budget (`LEAD_BUDGET_MS`, `left()` checks) and never start a call that cannot finish inside it.
- Catch-all or unverifiable domains: never labelled valid.
- Deep find cancelled mid-run: no new worker calls start.

## Testing
- Unit (vitest, node): `workerRules` (status/HTTP mapping, costs, refund decision, reply validation, "valid only" rule, labels); client behaviour with an injected fetch and usage client (reserve before call, refund once, fail closed, secrets never in output); the step-1c ordering as a pure decision function (worker verdict + Hunter availability -> action).
- Edge-function level: worker off, worker down, limit reached, each keep Deep find working as today.
- Live: set the two secrets (Kevin), then run Deep find on Love Living (the scraper should add `max@`/`david@`-style addresses with their source; a built address should be checked by the worker and Hunter credits should not be spent for it), confirm the usage meter moves, and confirm a refund when the worker is paused briefly.
- Before live use, a rolled-back or cleaned-up test for the usage counters as in sub-project A.

## Success criteria
1. With the worker on, Deep find checks built emails with the free checker first and spends Hunter credits only when the checker cannot decide.
2. Sites the page reader cannot read give addresses and phones through the scraper, with source shown.
3. With the worker off, down or over its limit, Deep find works exactly as before and says why a step was skipped.
4. Usage is reserved before every call and refunded at most once, only when the worker did no work.
5. No secret or raw worker text appears in the app, the logs or the results.
