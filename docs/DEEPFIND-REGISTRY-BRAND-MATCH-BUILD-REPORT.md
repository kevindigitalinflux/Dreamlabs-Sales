# Deep find registry brand match build report

Local build, 2026-11-03. Branch `codex/deepfind-registry-brand-match`, starting application revision `d779777`. Codex remains builder and Claude architect/reviewer. Independent review pending. Subscription usage is unavailable. Kevin's launch authorises this work despite the brief's anticipated renewal date.

## Root cause and Part A

`registryBrandMatch.test.ts` reproduced the Fold7 failure before implementation: location-based pick expected 04001759 but returned no chosen company. Existing searches spent their budget on the full marketing name and its variants, and all-word matching rejected FOLD 7 LIMITED. Compact comparison could bridge Fold7/Fold 7 but not remove the descriptor. New brand candidates now feed bounded registry searches, scoring, pickCompany and registry evidence name comparisons. Existing location, ambiguity, active-status, independent-proof and trust rules are retained. Existing Love Living tests pass in targeted checks.

Candidate extraction preserves original spelling, normalises whitespace, takes the first separator segment, uses the longest non-generic segment when the first is a single generic word, removes supported long marketing/HQ/site tails, and creates digit/word spacing alternatives. Candidates shorter than three characters and single generic/industry words are dropped. Maximum four; original full name follows specific candidates. Existing industry/generic sets moved unchanged to companyNameWords.ts and are re-exported from domainDiscovery.ts; no second vocabulary was introduced. Domain discovery SEARCH variants reuse the same extraction in one expression; real names used for trust decisions remain unchanged.

| Input | Extracted candidates, in order |
|---|---|
| Fold7 - Global Creative Advertising Agency London HQ | Fold7; Fold 7; full original |
| Fold 7 | Fold 7; Fold7 |
| Bright Fox Global Creative Advertising Agency London HQ | Bright Fox; full original |
| Acme — Official Site | Acme; full original |
| Agency \| Bright Fox | Bright Fox; full original |
| Love Living | Love Living |
| Sparkle Cleaning | Sparkle Cleaning |

Descriptor stripping is conservative, not a general natural-language classifier. Names without recognised separators/tails remain intact. Fixture tests cover London city/postcode agreement, no-location active competitor, wrong location, separators, generic exclusion and digit joins. City-only pickCompany tests do not relax registryEvidence's existing stronger postcode/address proof gate; a real city-only run may still require a choice.

## Part B: existing fallback, bounded improvement and remaining decision

Code confirms a deterministic reason Medium could not rescue Fold7: deepFind.ts's registry web proof condition explicitly accepts only High/Extra high. It also requires registry.how ambiguous, a Gemini key, more than 18 seconds left, a successful spend.ai reservation, and the enclosing deeper phase. Runtime keys, timing and cap state of Kevin's actual run are unavailable; no claim is made about those. The old query used the full descriptor name. Returned web numbers only contributed evidence for candidates already found by the name search; no registry profile retrieval added a web-only company.

The existing one-call query now uses the first brand candidate. resolveRegistry verifies up to three new grounded company numbers through the Companies House profile API, requires active status, brand-name agreement and existing known-location agreement, then passes candidates through unchanged independent evidence/ambiguity rules. Invalid numbers, failed profiles, unrelated/inactive companies and wrong-location profiles cannot be applied. Cached candidate arrays are copied, not mutated. Existing search-API candidates remain registry-verified candidates. No number is trusted from model prose alone.

The existing High/Extra high and ambiguous-only gates remain unchanged. Enabling this paid grounded step for Medium or not_found would create calls where none were made before; the brief also prohibits new paid calls. Claude must resolve that scope conflict. Therefore Part B is a bounded query/verification fix, not a claim that Medium now executes web proof. No AI call or reservation was added, and all existing spend guards remain.

## Part C: stopped under the brief's roughly 100-line rule

No engine ordering code was changed. A complete reorder is substantially larger than 100 changed lines: custom effort enables Hunter at the start; discovery around 450 precedes worker scrape around 542, own DNS/checker work around 657-812 and the preset deeper phase around 814. domainDiscovery also interleaves Hunter name/finder, name-built DNS, per-domain website checks, Hunter corroboration, then final site/web processing. Moving one call or awaiting web first would not meet the all-own-steps-first requirement.

Exact proposal for Claude:

1. Separate discovery into an own-source phase and an optional provider-completion phase, retaining one shared outcome and deduplicated candidate state. Keep saved/typed/blocked domain handling and source ranking unchanged.
2. Finish initial site/registry work, saved-page extraction, worker scrape, name-built DNS, own email checker and allowed web search before enabling any Hunter callback. Reuse fetched pages, DNS/check caches and provider failures.
3. Run the existing effort decision using own-phase facts, then invoke Hunter only for still-missing identity/domain/person details. Custom effort must also follow this order rather than enabling Hunter in first discovery.
4. Share the existing companyDomainHunterCap allowance and Spend reservation across both phases; do not reset caps, deadlines, corroboration or failure state. Preserve budget for final writes and notices.
5. Refresh registry evidence after own web/site discoveries, then run the optional Hunter name/finder/list/verifier work. Verify additional confirmed domains through existing guards rather than duplicating writes.
6. Add fake-provider integration tests for custom and each preset: every own phase precedes first Hunter request; missing/refused/exhausted Hunter still reaches lead completion with a plain notice; own successful results suppress unnecessary Hunter; budgets and reservations never exceed existing shares.

Such an engine refactor needs a separate reviewed scope. No fake-provider full-engine ordering/completion test was added because no reorder is built; existing tests cannot prove the requested end-to-end guarantee. Part C remains unfinished by the brief's explicit stop rule.

## Verification checkpoint

Dependencies and local MIME/IMAP test declarations installed offline, no manifest change. Baseline: 202 passing files, 2,793 passing tests, one skipped (2,794 total). TDD: Fold7/extraction tests failed first; grounded brand query failed first; web-only registry profile fixture failed first. Targeted new tests now pass. Final gates: npx tsc --noEmit zero diagnostics; npx vitest run 205 passing files, 2,803 passing tests and one skipped (2,804 total); npm run build passed with the existing chunk-size warning; node scripts/places-edge-typecheck.mjs passed (25 entrypoints); git diff --check passed. All full gates used the brief's dummy local Supabase environment. Application commits: 45c980f (brand matching and shared vocabulary), d2ccfac (web query/profile verification).

Not verified: Deno, live Companies House/Gemini, real run, actual historical Fold7 keys/budget, browser/phone/themes, production data or independent review. No push, merge, deployment, migrations, RLS/grant/schema changes, secret use, provider call, Supabase write, other-checkout write or vault sync occurred.

## Deployment manifest and next step

Static transitive relative-import graph identifies: run-deep-find, run-lookup-jobs, enrich-leads-bulk, find-decision-makers, org-api-settings, run-selected-autopilot and scrape-companies-house. Some bundles only inherit unchanged vocabulary through shared helpers; all importing bundles are listed so rollout cannot leave mixed shared versions. No frontend or migration required. Claude reviews this exact branch and the Part B/C limitations before any separately authorised function deployment. Stop after this report.
