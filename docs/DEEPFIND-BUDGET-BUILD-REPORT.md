# Deep find budget, registry eligibility and search status

## Result

All four fixes are built and tested locally on codex/deepfind-budget from fetched origin/main 3e0f2a310a95bb06480b4232d239c7814b0d8a25. Kevin directs; Claude architects/reviews; Codex builds. Independent review and live improvement remain unverified. No push, merge, deployment, migration execution, VPS change, installation, paid fallback or real provider request is authorized or occurred.

## Acceptance evidence

1. MET (Fix 1): three engine fixtures prove both budgets reach discovery; three discovery fixtures prove webSearch receives 25,000 ms with 120 seconds left, 10,000 ms with 40 seconds left and is not started below 34 seconds. Web starts before the site read. Other discovery work retains budgetMs capped at 10,000 ms. The optional webBudgetMs defaults to the prior budget for existing callers.
2. MET (Fix 2): fifteen pure saved-location fixtures and four engine fixtures pass. +1, Texas and +353 lead fixtures make no Companies House call and use no company registry proof credit. GB with a .com site still searches; UK postcode and unknown fixtures preserve eligibility. Saved country is never assigned or changed. The exact required skip line is emitted.
3. MET (Fix 3): seven new fixtures prove explicit 503/not_configured status, quiet refusal, one refund, no later worker dispatch for this lead, other 503s remaining unreachable, unchanged Gemini rung reservations and saved searxng=0/gemini=2. A new lead can retry the worker.
4. MET (Fix 4): eight error fixtures first logged search_failed, then emitted only timeout, http_429, http_503, bad_json or network as applicable. Assertions prove no key/prompt/query/reply/error text is logged. All existing fallback, grounding and cap cases still pass.

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
