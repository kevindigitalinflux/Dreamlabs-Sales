# Role search Gemini hits and brand names

## Result

Worktree: C:/Users/kevin/Projects/dreamlabs-sales-verifier-v2. Branch codex/role-search-hits was created from fetched origin/main b23a5912698687a164e40fe3809a959aebc76d51. Kevin directs, Claude architects/reviews, Codex builds. This is a local build; independent review remains pending.

Fix 2 is implemented. Fix 1 follows under Kevin's revised instructions: the real-call diagnostic is withdrawn; accept both direct and redirect grounding shapes and store a count-only diagnostic for zero-kept-hit fallbacks. No real Gemini request ran and no key file was created.

## Acceptance evidence

- MET (Fix 2): Cleancat - Commercial Cleaning Services Dublin queries the quoted brand Cleancat and accepts Ann Roe / Founder / Cleancat. Cleancat Solutions is still refused as company_mismatch.
- MET (Fix 2): all four first-separator forms, generic Cleaning fallback, trailing city removal and undescribed names pass. The real role ladder queries and judges the brand while retaining the complete lead context. All pre-existing judge fixtures pass unchanged.
- NOT VERIFIED (real reply shape): Kevin withdrew Step 1 before any real Gemini call. Direct and redirect fixtures will be synthetic contract fixtures, never labelled a captured reply.
- Pending (Fix 1): direct equality plus supported LinkedIn redirect evidence and the count-only result diagnostic.

## What changed

Fix 2 adds exported pure brandName in roleSearchRules.ts, uses it in roleQuery and adds the brand as an alternative to full/registered company evidence. Matching still prohibits extra distinctive words. roleSearch.ts already passes the full lead/company/city to roleQuery and judgeRoleHit; no additional production wiring change is needed there. Its new integration fixture verifies both query and judge paths.

Generic brand-prefix words are cleaning, cleaner, cleaners, commercial, service and services, in addition to the existing legal words and the lead's city words. The generic exclusion is used only to decide whether to shorten a descriptive name; it does not loosen company matching. A trailing matching city is removed case-insensitively; embedded cities and unseparated descriptions are preserved. Ninjas Cleaning LTD Dublin Cleaners and Schoonmaakbedrijf luxenettoyage remain unchanged, following the specified separator/trailing-city rule rather than inventing broader name rewriting.

TDD: the new brand export was absent and the query/real-ladder fixture failed before implementation. Eight new fixtures now pass. No existing assertion changed. All seven gates passed before this fix commit: 274 app files / 3,520 passed / one existing skipped; 8 wrapper files / 166 passed; root and wrapper TypeScript, production build, git diff --check and 29-entrypoint edge typecheck PASS. Logs: .superpowers/role-hits-brand-*.log. Fix 2 is the commit containing this initial report; its exact hash will be recorded in the final ledger.

## Not verified

Real grounded reply shape, production uplift, independent review, real database/RLS/concurrency, Docker/Compose and browser/mobile/runtime behavior. No push, merge, deploy, migration execution, VPS change, provider call, installation or spending occurred. The only external action was the requested git fetch. No credential value was printed or key file created.

## Deviations and open questions

Fix 2 was built first while the initial Fix 1 key-path question was pending. Kevin then withdrew the live call and supplied the two-shape and counts-only contract. There is no live-call authorization left. The real response shape must remain NOT VERIFIED after this task. The existing generic/distinctive helper treated Cleaning as distinctive; the separate brand-prefix generic list implements the explicit generic-prefix exception without changing existing judge assertions.
