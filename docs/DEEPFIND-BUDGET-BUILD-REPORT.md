# Deep find budget, registry eligibility and search status

## Result

All six local fixes (original Fixes 1–4 plus the appended Fix 5 and Fix 2b) are built and tested on codex/deepfind-budget from fetched origin/main 3e0f2a310a95bb06480b4232d239c7814b0d8a25. The latest continuation starts at 02b33b6 and supersedes the earlier direct-URL Gemini acceptance and non-UK saved-number exclusion. Kevin directs; Claude architects/reviews; Codex builds. Independent review and live improvement remain unverified. No push, merge, deployment, migration execution, VPS change, installation, paid fallback or real provider request is authorized or occurred.

## Acceptance evidence

1. MET (Fix 1): three engine fixtures prove both budgets reach discovery; three discovery fixtures prove webSearch receives 25,000 ms with 120 seconds left, 10,000 ms with 40 seconds left and is not started below 34 seconds. Web starts before the site read. Other discovery work retains budgetMs capped at 10,000 ms. The optional webBudgetMs defaults to the prior budget for existing callers.
2. MET (Fix 2, amended by Fix 2b): without a saved company number, +1, Texas and +353 lead fixtures make no Companies House call and use no company registry proof credit. GB with a .com site still searches; UK postcode and unknown fixtures preserve eligibility. Saved country is never assigned or changed. The exact required skip line is emitted. A saved company number again takes precedence under Fix 2b below.
3. MET (Fix 3): seven new fixtures prove explicit 503/not_configured status, quiet refusal, one refund, no later worker dispatch for this lead, other 503s remaining unreachable, unchanged Gemini rung reservations and saved searxng=0/gemini=2. A new lead can retry the worker.
4. MET (Fix 4): eight error fixtures first logged search_failed, then emitted only timeout, http_429, http_503, bad_json or network as applicable. Assertions prove no key/prompt/query/reply/error text is logged. All existing fallback, grounding and cap cases still pass.
5. MET (Fix 5): natural-language Gemini role prompt, grounded structured people, shared URL-free judge, optional independently proven LinkedIn and two added numeric people counters pass the appended contract/engine fixtures. SearXNG policy and its 48 judge fixtures remain unchanged.
6. MET (Fix 2b): quoted ten/eleven-digit North American formats infer non_GB; quoted UK/Irish national formats remain unknown. Saved company numbers again fetch registry profiles even for explicit/inferred non-UK leads. Country and saved number remain unchanged. Latest gates: 276 app files / 3,603 passed / one existing skip; 8 wrapper files / 166 passed; all seven PASS.

## What changed

Fix 1 adds webBudgetMs to DiscoveryInput and the discoverLeadDomains adapter. Both Deep find discovery call sites pass min(WEB_BUDGET_MS, max(0, left()-30,000)) independently of the unchanged 10,000 ms discovery budget. Only webTask consumes the new allowance and keeps the existing 4,000 ms admission threshold and 25,000 ms ceiling. Existing callers/tests remain compatible. The new 120-second fixture initially received 10,000 ms; engine fixtures initially lacked the new property, before production edits. No existing assertion changed.

Fix 1 gates: 274 app files / 3,546 passed / one existing opt-in skip; 8 wrapper files / 166 passed; root and wrapper TypeScript, production build, whitespace and 29-entrypoint edge typecheck PASS. Logs: .superpowers/deepfind-budget-fix1-*.log. The commit containing this initial report is Fix 1; exact hashes will be recorded in the final ledger. All seven gates precede each explicit-path implementation commit.

## Not verified

Real latency, production uplift, live provider/worker behavior, credit accounting, database/RLS/concurrency, Docker and browser/mobile/runtime checks. No production or provider request ran. The only external action was the requested git fetch. No secret was read or printed. The existing large-chunk build warning and opt-in skipped test remain.

## Deviations and open questions

The code's prior saved-company rule allowed a profile fetch on a non-UK lead. Kevin's new no-Companies-House rule takes precedence; Fix 2 updates and lists that conflicting assertion below. Unknown leads retain prior behavior. No unresolved behavior question. Subscription usage is unavailable; local evidence is saved per milestone. Runtime concurrency, live error shapes, time saved and credits saved are not established by these fixtures.

### Fix 2 — non-UK registry eligibility

MET: new pure likelyCountry uses explicit saved country first, then the shared parsePhone module without a default country, then address/postcode, then a UK website suffix, then unknown. National-format phone numbers alone do not manufacture GB evidence. It supports the primary phone and string-array additional_phones; +44 is GB and another parsed international prefix is non_GB. UK postcodes, US state names/abbreviations with ZIP/ZIP+4, .co.uk/.uk and precedence are tested. Fifteen pure fixtures and four engine fixtures pass. Engine fixtures first lacked the required skip line before implementation; the export was initially absent. +1, Texas and +353 cases make no Companies House call, have no company registry proof credit, and leave country unchanged. Saved GB with a .com site still searches.

The shared registrySkipReason now uses this inference, covering both discovery and blank-fill/review guards. The resolver checks non_GB before any saved-number profile lookup. The existing registry proof gate already excludes not_uk, so no new AI reservation path is needed. Unknown saved-number/rejected choices retain their old behavior. Exact step: Companies House: skipped, this company does not look UK-based.

Changed existing assertions: the three IE/US/OTHER registry step strings change to the required sentence; the prior saved-company-wins matrix now keeps only undefined/null/GB and separately expects not_uk/no fetch for IE/US/OTHER. No saved country or company number is changed or erased. All other assertions pass unchanged.

Gates: 275 app files / 3,565 passed / one existing skipped; 8 wrapper files / 166 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/deepfind-budget-fix2-*.log. Fix 1 commit: f6733ed. Fix 2 is the commit containing this entry.

### Fix 3 — configured search status and counters

MET: HTTP 503 is parsed for the exact error not_configured; every other 503 body (including an unreadable body) remains unreachable. Search not_configured has an empty failure line, is cached/refunded once by the worker client, and does not add a worker-failure step. Other worker routes keep their visible configuration refusals. The role provider additionally remembers not_configured per lead, skips worker calls on subsequent rungs and omits all such refusals from the searxng count. A new lead can try the worker again. Gemini still falls back on each not_configured rung, with unchanged AI reservations and the existing empty-result fallback rule. Actual unreachable/busy responses still count as attempts.

Tests first reproduced three calls instead of one, unreachable instead of not_configured, and saved searxng=2 instead of zero. A final unreadable-body fixture exposed an overbroad AbortError conversion, corrected before the final gates to preserve the explicit all-other-503 rule. Seven new fixtures cover status, refunds, other/missing/unreadable bodies, per-lead disabling, unchanged Gemini reservations and saved engine counts. Changed existing assertion: the worker search refunds-503 case with body error not_configured now expects not_configured instead of unreachable; network and throttled expectations remain unchanged.

Final gates: 275 app files / 3,572 passed / one existing skipped; 8 wrapper files / 166 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/deepfind-budget-fix3-final-*.log. Earlier full passing run (before the extra unreadable-body fixture) is deepfind-budget-fix3. Fix 2 commit: b8c188c. Fix 3 is the commit containing this entry.

### Fix 4 — fixed Gemini failure codes

MET: the provider catch logs the fixed prefix Role search unavailable and only a locally classified code. AbortError/TimeoutError and the existing Gemini request timed out error map to timeout; an anchored Gemini HTTP status prefix maps to http_<status> (100–599); SyntaxError and Gemini reply could not be read map to bad_json; all other exceptions map to network. The raw error message is inspected locally but never logged. This also keeps unexpected worker/reservation exceptions in the provider safe. No prompt, key, query, reply, URL, name or raw exception enters the log. HTTP provider bodies remain unlogged even when they are embedded in an exception message.

Eight fixtures were observed failing at search_failed before production edits, then passed. No existing assertion changed. Final gates: 275 app files / 3,580 passed / one existing opt-in skip; 8 wrapper files / 166 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/deepfind-budget-fix4-*.log. Fix 3 commit: 10fe463. Fix 4 is the commit containing the final report.

### Final commit and gate ledger

| Fix | Commit | App files / passed | Wrapper files / passed | Other gates |
| --- | --- | --- | --- | --- |
| 1 — web budget | f6733ed | 274 / 3,546 | 8 / 166 | All PASS |
| 2 — non-UK registry | b8c188c | 275 / 3,565 | 8 / 166 | All PASS |
| 3 — search status | 10fe463 | 275 / 3,572 | 8 / 166 | All PASS |
| 4 — safe failure codes | Commit carrying this final report, titled fix: log fixed role search failure reasons | 275 / 3,580 | 8 / 166 | All PASS |

All seven commands ran before every implementation commit: npx tsc --noEmit; npx vitest run; npm run build; git diff --check; node scripts/places-edge-typecheck.mjs; then npx tsc --noEmit and npx vitest run in worker/wrapper. The whitespace runner uses core.safecrlf=false and does not rewrite line endings. Each app run has one existing opt-in skipped test and zero failures at the commit gate. Environment: VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. Forty app fixtures were added against the 3,540 baseline. No wrapper source or test changed. Existing large-chunk warning remains. The exact final commit hash is supplied in the final handoff because a commit cannot embed its own hash. Commit hooks were disabled only per invocation to preserve the accepted-main mirror.

### Complete changed-existing-assertion inventory

- Fix 1: none. All existing discovery and engine assertions pass unchanged.
- Fix 2: the IE/US/OTHER step-string matrix now expects "Companies House: skipped, this company does not look UK-based." instead of "Companies House skipped: this is not a UK company.".
- Fix 2: the saved-company matrix retains undefined/null/GB saved profile behavior, while IE/US/OTHER now expect not_uk and no profile request, overriding the former saved-number exception. The saved number and country are not erased.
- Fix 3: the existing 503 worker-search fixture whose JSON says not_configured expects not_configured instead of unreachable. Its one-refund/one-dispatch assertions remain; network and throttle expectations are unchanged.
- Fix 4: none. No other old assertion was altered or weakened. Engine fixtures retain mocked providers and filter-aware saved data; no real request was used.

### Redeploy list (proposal only, not performed)

Recursive relative-import traversal from every function index.ts, including type-only and dynamic imports, finds this conservative union for changed deepFind, domainDiscovery, domainDiscoveryLookup, deepFindRegistry, deepFindSuggestions, likelyCountry, workerClient and searchProvider:

- enrich-leads-bulk
- find-decision-makers
- generate-email
- org-api-settings
- run-deep-find
- run-lookup-jobs
- run-selected-autopilot
- run-verify-queue
- scrape-companies-house
- send-email

The local graph is retained in ignored .superpowers/deepfind-budget-redeploy.json. Frontend publication is also part of the proposed surface because DeepFindLeadResult, deepFindReview and deepFindView consume the shared registrySkipReason helper; suggestion/replacement components import the same shared module. The helper uses whichever saved metadata each caller supplies. This task does not expand historical UI queries or change explicit user country-rejection actions/messages. No wrapper/container, migration, database schema, secret or environment-variable update is needed. All publication remains separately authorized work.

### Final limits and next action

The quoted production observations were supplied by Kevin/Claude, not independently retrieved in this session. No scoring run, live provider request, real registry request, paid AI call, SQL/audit, production credit measurement, database concurrency, container startup or browser/mobile check ran. Local gates and fixtures prove the requested paths; they do not prove improved production pass marks. Independent review remains pending. No role change occurred. No secret or credential was read or printed; no local key path was created. The only external operation was the requested git fetch.

Open this worktree and docs/HANDOFF.md, then this report. The checkout is clean at the final report commit and no task-owned server is running. Claude reviews four commits next. Kevin separately authorizes any rollout or live timing/credit/scoring checks. Builder stops here; older rollout instructions do not grant this branch production authority.

## Continuation — role-search prompt and US registry skip (2026-11-17)

Kevin authorized Fix 5 and Fix 2b on codex/deepfind-budget from 02b33b6. Same builder/reviewer roles and local-only limits. These newer rules supersede earlier direct-URL person acceptance and the previous non-UK saved-number exclusion. No live request or rollout is authorized. The supplied production re-run evidence was not independently read.

### Fix 5 — grounded people instead of copied-result hits

MET: rolePeoplePrompt takes company/city/country/roles, labels a JSON company block as data, requests CURRENT role holders in natural language across public LinkedIn profiles, company websites and news, and says not to log in. It asks for one supported sentence per person, followed by one strict name/title/company/linkedin_url JSON object per person. It contains no raw search operator or copied-results instruction. SearXNG still receives roleQuery unchanged. The ladder and its checkpoint wrapper pass structured lead/rung context separately to the Gemini path.

Gemini requires at least one grounded source and both name words in one source URI's title or supported segment. judgeRolePerson shares the extracted name/company/current-role/former-role core with judgeRoleHit without needing a profile URL. All 48 existing SearXNG judge fixtures pass unchanged. Gemini returns judged people, not synthetic search-result hits. LinkedIn is nullable throughout the role/team combination and contact path: it is saved only for a valid profile URL that is an exact grounded source or has same-name evidence in a LinkedIn-titled chunk. A company/news source can establish the person without establishing LinkedIn. No result URL is fetched by this build.

MET: the redirect-contract fixture is kept with LinkedIn; the same supported person without a LinkedIn chunk is kept without it. Missing name evidence, sources=0, former Owner and extra-company words are refused. Both real-engine contact paths save source role_search, include_in_sequences=false; unsupported LinkedIn stays null. Natural-language prompt/context wiring and zero-result numeric diagnostics are tested. These are synthetic real-format fixtures, not newly captured provider responses. The real model's response and live uplift remain NOT VERIFIED.

Diagnostics retain the zero-kept-person emission rule. people_lines counts decoded objects with all four correctly typed person fields; people_kept records the number passing grounding and the judge (zero in an emitted zero-person diagnostic). Existing lines_parsed counts all decoded JSON lines; profile_urls now counts valid linkedin_url values from person objects. The other source counters retain their meaning. The result object contains only seven numeric counts; it stores no new name, URL, query, prompt, reply or evidence text. Successful person replies do not emit a fallback-shape diagnostic, preserving the existing rule.

TDD: ten new fixtures failed before implementation at the missing prompt/judge exports, absent people return, missing ladder person and missing counters. They now pass; one extra engine matrix case checks the no-LinkedIn contact. The existing cap, rung, cancellation, role/title/name, company, blank-fill, no-enrollment and fixed-log tests all pass. The earlier prompt export's missing function and the old empty-hit behavior were observed before production edits. An intermediate TypeScript run caught zero-argument fixture-spy inference and an unused import; both were corrected before the full gates.

All seven gates before Fix 5: 276 app files / 3,591 passed / one existing opt-in skip; 8 wrapper files / 166 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/deepfind-role-people-fix5-*.log. Fix 5 is the commit containing this continuation entry.

Changed existing assertions/fixtures for Fix 5 (complete inventory):

- Gemini acceptance expectations return structured people with normalized first/last/title/rung and nullable linkedinUrl instead of hits. SearXNG hit expectations are unchanged.
- The old direct-URL/no-sourceEvidence case now expects no people: URL equality alone no longer proves a person.
- Redirect/regional-title success cases still succeed, now from strict person JSON. Empty/busy/not-configured/unreachable fallback counts and AI reservations are unchanged; their successful fixture payloads gain person JSON and name evidence.
- Non-LinkedIn or spoofed LinkedIn-title chunks with valid person evidence now retain the person without LinkedIn, rather than dropping the entire hit. Missing/substring-only names and source-URI collisions still reject.
- A LinkedIn source HOST with a different profile URL but no LinkedIn domain TITLE establishes the person only, so its previously saved profile becomes null under the stricter link rule.
- A name supported only on a separate non-LinkedIn chunk now establishes a person without borrowing the unrelated LinkedIn title; it no longer causes complete person rejection.
- All four invalid-profile-URL cases retain the grounded person with a null link instead of dropping the entire hit.
- The old off-source invented-profile fixture is replaced by an invented-person name absent from grounding. Its prose/invalid-JSON rejection and single valid-person expectation remain.
- Provider diagnostic expectation adds people_lines=2 and people_kept=0. Both normal/interrupted engine diagnostic expectations add people_lines=1 and people_kept=0. Old five keys keep their counts after fixtures switch to person JSON.
- The engine's supported-profile fixture retains all old assertions and additionally checks the saved link; its new unsupported-link companion expects null. Test transport helpers supply the structured company/rung context the real ladder now passes. No SearXNG judge assertion changed or was weakened.

No schema, migration, usage cap, retry delay, role ladder, two-person limit or enrollment rule changed. judgeRoleHit was refactored onto a shared evidence core, with its profile admission/normalization and acceptance policy preserved by its unchanged fixtures. The new per-provider return shape prevents Gemini people from being forced through an invented profile URL.

### Fix 2b — North American national phones and saved-number precedence

MET: after the existing international shared-parser path, likelyCountry removes only spaces, dots, dashes and brackets from national phone text. Exactly ten digits with area-code and exchange leading digits 2–9, or eleven digits with a leading 1, infer non_GB; a raw leading zero never qualifies through this national heuristic. This applies to primary and additional phones. Explicit saved country retains its first priority. No lead.country or company_number is written by inference.

The quoted (214) 555-0182, 214-555-0182 and 1 214 555 0182 fixtures were unknown before the fix and now return non_GB. 020 7946 0958 and 01 234 5678 remain unknown. Extra fixtures cover dotted additional phones, invalid area/exchange leading digits and explicit GB precedence. The real engine skips registry work/proof credits for an unsaved national US phone. No new country is assigned.

As Kevin now explicitly directs, clean saved company_number is resolved before registrySkipReason. Saved numbers therefore reuse Companies House even when likelyCountry says non_GB. This restores the earlier saved-number exception and supersedes this report's original Fix 2 paragraphs where they conflict. Leads without a saved number still use the non-UK skip rule. A saved-number + US phone resolver and engine fixture prove the profile call, unchanged country/number and no separate registry proof credit.

TDD: the three quoted US formats, three explicit-country saved-number cases and the saved-number/+1-phone case failed before production edits. Added engine and dotted-additional-phone fixtures also failed before implementation. The final focused 75 tests pass. New tests: nine country matrix rows, one resolver fixture and two engine cases. Changed existing assertions: the IE/US/OTHER saved-number matrix now expects saved/12345678 and exactly one profile fetch instead of not_uk/null/no fetch. Unknown/null/GB saved-number cases and no-saved-number skips are unchanged. No other old assertion changed in Fix 2b.

All seven gates before Fix 2b: 276 app files / 3,603 passed / one existing opt-in skip; 8 wrapper files / 166 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/deepfind-national-phone-fix2b-*.log. No new wrapper, schema, migration, dependency, environment, secret or cap change.

### Continuation commits and gate counts

| Fix | Commit | App files / passed | Wrapper files / passed | Other gates |
| --- | --- | --- | --- | --- |
| 5 — natural-language grounded people | 3b99783 | 276 / 3,591 | 8 / 166 | All PASS |
| 2b — national phones / saved number | Commit containing this final continuation report, titled fix: recognize national US phones and prefer saved registry numbers | 276 / 3,603 | 8 / 166 | All PASS |

Both commits run the same seven required gates and local placeholder environment documented above, with explicit staging and one commit per fix. Existing opt-in skip and large-chunk build warning remain. The continuation adds 23 passing tests against 3,580 (11 in Fix 5 and 12 in Fix 2b). No provider request, key access, installation, spending, production read/write, SQL/audit, migration, VPS change, push, merge or deployment occurred. Subscription usage is unavailable. The exact final hash is supplied in the final handoff; a commit cannot include its own hash.

### Continuation redeploy surface and limits

A fresh relative-import traversal from every edge index.ts (including dynamic and type-only imports) gives the same conservative ten-function union: enrich-leads-bulk, find-decision-makers, generate-email, org-api-settings, run-deep-find, run-lookup-jobs, run-selected-autopilot, run-verify-queue, scrape-companies-house and send-email. The changed targets for this continuation are deepFind, deepFindRegistry, likelyCountry, roleSearch, roleSearchRules, searchProvider and teamPageRules. Frontend also consumes likelyCountry through the shared registry helper. Graph evidence is ignored .superpowers/deepfind-continuation-redeploy.json. This is a proposed publication surface only. No wrapper/container, schema/migration, secret or environment-variable rollout is needed.

NOT VERIFIED: whether the revised prompt grounds in the deployed model, real grounding metadata, real current-person/company accuracy, live timing/credits/pass marks, database/RLS/concurrency, visual/mobile, container/provider runtime and independent re-review. Source/fixture evidence does not prove production uplift. The supplied source-zero production evidence was not independently fetched. These fixtures are synthetic and privacy-safe; no real personal response was captured. The earlier one-call authorization remains withdrawn.

No unresolved build question. SearXNG still uses its existing query and judge policy; Gemini uses grounded person records and a shared evidence core without needing a profile URL. A valid person can be saved without LinkedIn, never enrolled automatically. Diagnostic emission remains restricted to zero-kept-person results, so people_kept is zero in those saved diagnostic objects. The current full local branch contains six implementation commits; the newest two supersede the specific earlier policies listed above. Codex stops here. Claude reviews the continuation, then Kevin separately authorizes any rollout/live checks. Read the top of docs/HANDOFF.md to resume.
