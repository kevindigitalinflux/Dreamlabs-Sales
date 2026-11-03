# Fix round 1: exact brand match, web proof on Medium, own sources before Hunter, email verifier reliability (Claude review of aa84b51)

Parts: 1 exact derived-brand matching (blocking bug), 2 web proof on Medium, 3 own sources before Hunter, 4 email verifier reliability. Allowance is limited: commit after each part, and if you must stop early, stop after finishing a part and write what is left in the report addendum.

You are Codex, the builder. Claude is architect and reviewer. Kevin directs. Same worktree and branch as the build: `C:/Users/kevin/Projects/dreamlabs-sales-accuracy`, `codex/deepfind-registry-brand-match`. Keep reads targeted; commit in small steps; stop after the report addendum.

## Finding (confirmed by Claude with a scratch test, not committed)
Gates re-run by Claude: tsc clean, 205 files / 2,803 tests (1 skipped), `git diff --check` flags only blank lines at EOF in `docs/DEEPFIND-REGISTRY-BRAND-MATCH-BUILD-REPORT.md` and `supabase/functions/_shared/companyNameWords.ts` (remove them). Fold7 now picks FOLD 7 LIMITED correctly.

But the brand change loosened matching too far. `pickCompany`, `scoreCompanyCandidates` and `registryEvidence.matchRegistryEvidence` accept a company when ALL words of ANY brand candidate appear in the company name (subset rule). A derived first segment is often only part of the real name, so:
- lead `Smith - Plumbing Services London HQ`, one active `SMITH ROOFING LIMITED` in the same city -> `auto_location` (WRONG company chosen)
- lead `Bright - Fox Cleaning`, one active `BRIGHT SPARK LIMITED` in the same city -> `auto_location` (WRONG)
The legacy path in `registryEvidence.ts` (~line 80, `pickCompany(...).chosen` plus `E2`) then keeps it. A wrong company attached to a lead means wrong officers and wrong people looked up.

## Part 1: required change
1. The ORIGINAL full lead name keeps the existing subset rule exactly as before this build (no behaviour change for names without a descriptor).
2. Any DERIVED brand candidate (everything `brandNameCandidates` returns except the original name) matches a company only when the company's name tokens (legal forms removed, via the existing `companyNameTokens`) are EXACTLY the same set as the brand's tokens, or `sameCompanyName(company, brand)` is true (this keeps `Fold7` = `FOLD 7 LIMITED`). Apply the same exactness in `scoreCompanyCandidates` (the `all` bonus), `pickCompany` (`matches` and `isExact`) and `matchRegistryEvidence` (`allWords`).
3. Partial matches still appear in the candidate list for the user to choose (so `SMITH ROOFING LIMITED` can be offered), they just never auto-pick.
4. Tests first (they must fail on aa84b51): the two cases above return `chosen: null` (reason `ambiguous`) through BOTH `pickCompany` and the full `matchRegistryEvidence` path with outward-code and postcode agreement; Fold7 still auto-picks FOLD 7 LIMITED; `Acme - Official Site` picks `ACME LIMITED` but not `ACME ROOFING LIMITED`; Love Living tests unchanged. Also keep the digit join cases (`Fold 7` and `Fold7`).

## Constraints
Same as the build brief: no schema, RLS, grant, migration or new dependency; no push, merge, deploy or secrets; stage explicit paths; commits with `git -c core.hooksPath=NUL commit` ending `Co-Authored-By: Codex <noreply@openai.com>`. Do the work in the order of the parts below, one commit per part, tests first.

## Part 2: web proof on Medium (Kevin approved 2026-11-03)
Today the registry web-proof step in `deepFind.ts` runs only for High and Extra high, only when `registry.how` is ambiguous, needs a Gemini key, more than 18 s left and a successful `spend.ai` reservation. Fold7 was a Medium run. Change the effort gate so Medium also runs it (Low stays free-only and never runs it). Also run it when the registry result is `not_found`/none, not only ambiguous, for Medium, High and Extra high. Keep: one grounded call per lead, the `spend.ai` reservation and AI cap, the time check, and the rule that any returned company number is verified against the Companies House profile API (active, brand name agrees by the exact rule from Part 1, location agrees) before use. Update the Medium explanation text in `EFFORT_LEVELS` / the confirm step if it lists what Medium does, and the `deepPhaseDecision` wording only if needed. Medium's AI allowance per lead (`ai: 2`) must cover it; report if it does not. Tests: gate matrix by effort (low off; medium/high/extra_high on for ambiguous and none; custom unchanged), reservation refusal skips quietly with a plain step line.

## Part 3: own sources before Hunter (Kevin approved 2026-11-03)
Claude's reading, to verify first: the preset efforts (low, medium, high, extra_high) ALREADY follow free-first. `deepEnabled` starts false for presets (`deepFind.ts` ~145-148, provider keys nulled), the free phase runs, then `deepPhaseDecision` (~814-830) enables Hunter/Gemini/Apollo only if something is still missing (extra_high always). So Kevin's Medium run did not call Hunter first. The Hunter-first problem is CUSTOM effort: `deepEnabled = effort === 'custom'` (~145), so Hunter is live from the first discovery call (~450). Codex's earlier report concluded a >100-line refactor; check whether the simpler route works:
1. Make `custom` use the same two-phase structure as presets: start with providers off, run the free phase, then run the existing deep-phase block with `deepPhaseDecision('custom', ...)` (it already returns run=true for custom) and enable Hunter with the custom caps. Reuse whatever the preset path already does after enabling (a second discovery pass, Hunter people lists, etc.); do not duplicate logic.
2. If custom then loses a step that only ran in the first discovery with Hunter on, make sure it runs in the deep phase instead.
3. Tests with a fake provider that records call order for custom, medium, high, extra_high: every own step (site read, worker scrape, DNS checks, own email checker, Companies House, web search where allowed) precedes the first Hunter request; with Hunter exhausted/refused/missing the lead still completes with a plain notice; Hunter reservations, per-lead share (`companyDomainHunterCap`) and caps are unchanged.
4. If this still needs more than about 150 changed lines, stop and write the exact proposal in the report.

## Part 4: email verifier reliability and fewer "not verified" suggestions (Kevin approved 2026-11-03)
Kevin: too many suggestions say the email is not verified; our own verifier should run from Low effort onwards.
Claude's read-only look at the last 3 days of `deep_find_leads` step lines (production, aggregated, no names kept): the checker WORKS (runs report 0 to 5 valid addresses out of 5), but unverified guesses come from these causes, most common first:
- "The email checker took too long to answer for this address." (18) and "This mail server answers too slowly to check, so these are best guesses." The client timeout is 20 s (`WORKER_TIMEOUT_MS.verify`), the worker's own limit is 30 s.
- "The email check limit for this run or domain was reached." Per-lead cap `MAX_VERIFY_PER_LEAD` is 6, the worker allows 5 checks per domain per minute, and the org allowance is 150 checks per day (`EFFORT_DAILY_LIMITS.checks`), so a 20 to 50 lead run can exhaust it.
- Microsoft 365 / hosted-provider domains ("where checks are less reliable", e.g. fold7.com, arup.com, accenture.com). SMTP checks cannot confirm mailboxes there; this is inherent. Do NOT add any tenant or account enumeration technique (for example Microsoft sign-in endpoints) to work around it.
- "Hunter is used up this month", so the Hunter fallback cannot settle the doubt.
Build, in this order:
1. Confirm and test that the checker is used from Low: in the free phase for the lead's own email, scraped addresses and built guesses, for every effort including Low, and report any path where it is skipped by effort. Fix only skips that contradict "on for Low onwards".
2. Timeouts: let the verify timeout use more of the remaining budget (up to the worker's 30 s) when `left()` allows, and retry a `timeout` once for a different address on the same domain only if time and the per-domain rate allow. Never exceed the worker's per-domain throttle; space checks per domain instead of failing them. Keep `reserveUsage`/refund rules exactly as they are (a client timeout is not refunded).
3. Spend checks on the best candidates first: order by person importance (owner/decision maker, then others) and by the inferred pattern's rank, so the per-lead and daily allowance goes to addresses most likely to matter. Report the daily allowance maths for a 50-lead run; do not change the allowance values.
4. Fewer noisy suggestions: show at most ONE unverified guess per person as a normal suggestion (best-ranked), put the rest only under the existing "Other possible formats" group, and write the Microsoft 365 / hosted-provider / catch-all / timeout reason ONCE per domain in the run notes instead of repeating it on every person. Keep the label "Guess, unverified"; never fill an unverified guess in automatically; sequence opt-out unchanged.
5. Tests for each point (fake worker client: timeouts, throttle, limit reached; ordering; suggestion grouping).
Report: how many of the causes above are now handled, what remains inherent (Microsoft 365), and whether the worker itself looks slow (no VPS access is needed; do not touch the worker).

## Gates and deliver
`npx tsc --noEmit`, `npx vitest run`, `npm run build`, `git diff --check`, `node scripts/places-edge-typecheck.mjs` with the dummy env. Append a short "Fix round 1" section to the END of `docs/DEEPFIND-REGISTRY-BRAND-MATCH-BUILD-REPORT.md` with the failing-then-passing tests, exact gate counts and anything not verified. Then stop.
