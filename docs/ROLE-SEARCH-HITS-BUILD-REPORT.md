# Role search Gemini hits and brand names

## Result

Worktree: C:/Users/kevin/Projects/dreamlabs-sales-verifier-v2. Branch codex/role-search-hits was created from fetched origin/main b23a5912698687a164e40fe3809a959aebc76d51. Kevin directs, Claude architects/reviews, Codex builds. This is a local build; independent review remains pending.

Both fixes are implemented locally. Direct grounded URL matches remain accepted; LinkedIn chunk/segment evidence can now support a profile when grounding uses redirect URLs. Descriptive names query and match their distinctive brand. Zero-kept-hit Gemini fallbacks save only the five approved diagnostic counts.

Kevin withdrew the real-call Step 1 before any Gemini request. Both reply-shape fixtures are synthetic contracts, not captured production replies. No key file was created and no credential value was printed. The real reply shape is NOT VERIFIED.

## Acceptance evidence

- MET (Fix 2): Cleancat - Commercial Cleaning Services Dublin queries the quoted brand Cleancat and accepts Ann Roe / Founder / Cleancat. Cleancat Solutions is still refused as company_mismatch.
- MET (Fix 2): all four first-separator forms, generic Cleaning fallback, trailing city removal and undescribed names pass. The real role ladder queries and judges the brand while retaining the complete lead context. All pre-existing judge fixtures pass unchanged.
- MET (Fix 1, Shape A): a grounded source URL equal to the valid LinkedIn hit URL keeps the hit without requiring sourceEvidence. All existing direct-URL cap/fallback fixtures pass unchanged.
- MET (Fix 1, Shape B): a synthetic redirect source with a LinkedIn domain title and same-source supported first/last name keeps the profile. Regional uk.linkedin.com and en-gb.linkedin.com titles pass; a LinkedIn source host with its own name evidence also qualifies as explicitly allowed by the revised host rule.
- MET (Fix 1 exclusions): absent names, substring-only names, non-LinkedIn or spoofed domain titles, source-URI prefix collisions, attacker-host redirects, unrelated non-LinkedIn support and invented/invalid profile URLs are dropped. Company/current-role/name judgment still runs afterwards; Fix 1 does not change judgeRoleHit.
- MET (diagnostic): zero-kept-hit fallbacks emit exactly lines_parsed, profile_urls, sources, redirect_sources and linkedin_titled_sources as numbers. The engine saves role_search_fallback_shape in normal and interrupted result JSON. No URL, query, name or snippet enters that object. A kept fallback hit emits no diagnostic. The real-engine fixture proves sourceEvidence reaches the provider and produces a non-enrolled role contact.
- NOT VERIFIED (real reply shape): Step 1 was withdrawn. No fixture is represented as a real captured response and no live improvement is claimed.

## What changed

Fix 2 adds exported pure brandName in roleSearchRules.ts, uses it in roleQuery and adds the brand as an alternative to full/registered company evidence. Matching still prohibits extra distinctive words. roleSearch.ts already passes the full lead/company/city to roleQuery and judgeRoleHit; no additional production wiring change is needed there. Its new integration fixture verifies both query and judge paths.

Generic brand-prefix words are cleaning, cleaner, cleaners, commercial, service and services, in addition to the existing legal words and the lead's city words. The generic exclusion is used only to decide whether to shorten a descriptive name; it does not loosen company matching. A trailing matching city is removed case-insensitively; embedded cities and unseparated descriptions are preserved. Ninjas Cleaning LTD Dublin Cleaners and Schoonmaakbedrijf luxenettoyage remain unchanged, following the specified separator/trailing-city rule rather than inventing broader name rewriting.

TDD: the new brand export was absent and the query/real-ladder fixture failed before implementation. Eight new fixtures now pass. No existing assertion changed. All seven gates passed before this fix commit: 274 app files / 3,520 passed / one existing skipped; 8 wrapper files / 166 passed; root and wrapper TypeScript, production build, git diff --check and 29-entrypoint edge typecheck PASS. Logs: .superpowers/role-hits-brand-*.log. Fix 2 is the commit containing this initial report; its exact hash will be recorded in the final ledger.

Fix 1 extends the Gemini dependency type with optional sourceEvidence and consumes the existing geminiGroundedSearch return unchanged through deepFind.ts. It accepts direct URL equality or a supported LinkedIn chunk. For the evidence path, sourceEvidence lines are grouped by their exact leading source URI plus a space; the first line supplies the chunk title and later lines supply supported text. Source hosts/titles use the same LinkedIn regional-domain pattern as the existing judge. Profile URLs use its existing http(s), no-credentials, allowed-host and /in/ path check. Redirect trust is restricted to vertexaisearch.cloud.google.com with a nonempty /grounding-api-redirect/ path, rather than accepting arbitrary hosts that claim a LinkedIn title. First/last name words are matched as whole words within the same source's evidence, never from the URL or from another site's segment. No result URL is fetched.

The provider callback emits a fresh fixed-field object only after a Gemini reply yields zero kept profiles. deepFind.ts stores the latest such fallback's counts for that lead, not a sum across rungs. If a later fallback succeeds, earlier diagnostic evidence remains available; if no fallback returns zero kept hits, the field is absent. Both normal and error/authorization-stop summaries retain the diagnostic. The exact five keys are the entire diagnostic payload; the surrounding result keeps its existing normal data.

Counter meanings: lines_parsed counts JSON-decodable lines among the first 100 reply lines, including JSON objects rejected by boundary validation; profile_urls counts those whose validated URL passes the profile check; sources counts the returned source array entries; redirect_sources counts entries on the approved redirect host/path; linkedin_titled_sources counts entries whose associated title line is an allowed LinkedIn domain. The existing reply limit of eight kept hits remains. Empty provider text produces zero parsed/profile counts. A provider exception before a reply does not invent a reply-shape diagnostic.

TDD for Fix 1: redirect and regional-source acceptance returned empty hits before implementation, the callback was never called, and all three real-engine fixtures failed at missing counts/contact. These were observed red before production edits. The focused rules/provider/engine tests now pass, along with the existing cap, fallback and judge cases. An intermediate edge typecheck identified an inferred empty-array type in the new token helper; an explicit string[] return type corrected it before the full gate run.

### Reply shapes (synthetic and redacted, NOT captured)

Shape A:

```json
{"text":"<one JSON hit line>","sources":["https://linkedin.com/in/SYNTHETIC"],"sourceEvidence":[]}
```

Shape B:

```json
{"text":"<one JSON hit line>","sources":["https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED"],"sourceEvidence":["https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED linkedin.com","https://vertexaisearch.cloud.google.com/grounding-api-redirect/REDACTED <synthetic first> <synthetic last> <supported segment>"]}
```

The fixtures contain fictional test identities only. Their shape follows the existing ai.ts formatter: URI plus chunk title, then URI plus supported segment linked by groundingChunkIndices. This is source inspection and a contract test, not confirmation that production Gemini currently returns either shape.

### Commits and seven gates

| Fix | Commit | App files / passed | Wrapper files / passed | Other gates |
| --- | --- | --- | --- | --- |
| 2: brands | 7dadcc2 | 274 / 3,520 | 8 / 166 | All PASS |
| 1: grounding and diagnostic | Commit containing the final report, titled fix: retain grounded LinkedIn hits and record fallback shape | 274 / 3,540 | 8 / 166 | All PASS |

Every app run has one pre-existing opt-in skip, zero failed tests at commit. Both fixes ran all seven required gates: npx tsc --noEmit; npx vitest run; npm run build; git diff --check; node scripts/places-edge-typecheck.mjs; npx tsc --noEmit and npx vitest run in worker/wrapper. The runner uses git -c core.safecrlf=false diff --check to avoid CRLF conversion noise and does not normalize files. Environment: VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. Logs: .superpowers/role-hits-brand-*.log and .superpowers/role-hits-grounding-*.log. Edge shim remains 29 entrypoints; the existing large-chunk build warning remains. No dependency was installed or changed. Only explicit paths were staged, and per-command commit hooks were disabled to prevent a task branch overwriting the accepted-main vault mirror.

### Changed existing assertions

None. All prior direct URL, cap/fallback, role, company, name, authorization and engine assertions pass unchanged. The existing phase-one engine harness adds a mocked grounded search and a not-configured worker search default; it does not change old expectations. New tests comprise eight brand fixtures, seventeen provider fixtures and three engine fixtures. No tier, verdict, schema, migration, provider cap, retry delay or role ladder value changed.

### Redeploy list (proposal only)

Only run-deep-find. A recursive relative-import scan from every function index.ts, including type-only and dynamic imports, reaches the changed deepFind.ts, searchProvider.ts and roleSearchRules.ts from that single entrypoint. No frontend, wrapper, container, secret or migration update is required by these two fixes. Deployment remains unauthorized and was not performed. After an independently reviewed and authorized rollout, read role_search_fallback_shape from a lead result with a zero-kept-hit fallback to inspect the actual shape counts. Counts cannot establish the source text's contents, the real response's complete structure or production quality.

## Not verified

Real grounded reply shape, production uplift, independent review, real database/RLS/concurrency, Docker/Compose and browser/mobile/runtime behavior. No push, merge, deploy, migration execution, VPS change, provider call, installation or spending occurred. The only external action was the requested git fetch. No credential value was printed or key file created. No production scoring run or fallback diagnostic was read; no claim is made that these fixes alone meet the programme's live pass marks.

## Deviations and open questions

Fix 2 was built first while the initial Fix 1 key-path question was pending. Kevin then withdrew the live call and supplied the two-shape and counts-only contract. There is no live-call authorization left. The real response shape must remain NOT VERIFIED after this task. The existing generic/distinctive helper treated Cleaning as distinctive; the separate brand-prefix generic list implements the explicit generic-prefix exception without changing existing judge assertions.

There are no unresolved build decisions. Diagnostic counts represent the latest zero-kept-hit fallback for a lead, preserving useful failure evidence through a later success or interruption. Judge role/company policy changes only for the approved brand alternative in Fix 2; Fix 1 leaves that judge unchanged. Codex stops here. Claude reviews the two commits; any rollout or live checks need Kevin's separate authorization. Subscription usage is unavailable; no paid continuation was used.
