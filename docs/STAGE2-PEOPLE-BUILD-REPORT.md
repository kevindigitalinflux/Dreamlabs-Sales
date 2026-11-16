# Deep find Stage 2 people — final local build report

## Result and branch tips (2026-11-16)

Verifier defects and Stage 2 Tasks 1, 2, 3, 4, 5, 5b, 5c and 6 are built locally. The final code revision is 50ca647b40f7b2fe345e9c35d4ddc6c173a0a93b. Codex stops after the Task 6 report commit. Claude remains architect/reviewer; independent review is pending.

- Worktree: C:/Users/kevin/Projects/dreamlabs-sales-verifier-v2.
- Verifier branch tip: codex/verifier-v2-defects at cf6006e635f15660f8f846a0877f3039daf4ee92.
- Stage 2 tested application tip: codex/stage2-people at 50ca647b40f7b2fe345e9c35d4ddc6c173a0a93b, followed by the final Task 6 documentation/scoring commit containing this report. Resolve its final tip with git rev-parse codex/stage2-people; the final handoff message supplies that exact hash. A commit cannot embed its own hash.
- Base: git fetch origin returned origin/main 8c1c61b, matching the brief. Only the named worktree was edited. Explicit paths were staged. Commit hooks were disabled per invocation to prevent an unapproved task-branch vault sync.

## Acceptance evidence

1. **MET (local): verifier Fix A.** Migration 076 uses each queue row's created_at for its hour and retains the three-hour run backstop and five-minute stale recovery. Cancellation expires recent running rows immediately. Queue access checks use the claimed timestamp; done-proof recovery keeps its finished_at hour. Five new tests passed after reproducing failures. Both audits are written only; database behavior is **NOT VERIFIED**.
2. **MET (local): verifier Fix B.** The wrapper uses 45,000 ms, reports aborts as timeout, isolates stalled domains after two failures for ten minutes and emits fixed-field hashed-domain logs. Edge refusals refund usage, restore the local lead cap, requeue without spending an attempt and preserve other domains. Microsoft person plans use ms_exists in every state with four formats; company/role addresses remain SMTP. Kevin approved queue-only 48,000 ms calls and a 55,000 ms reserve. Part 1 ends with 267 files / 3,383 passed, one skipped; wrapper seven files / 149 passed.
3. **MET (local): Stage 2.** SearXNG route/container configuration, worker_search limits, role rules, profile arrays/editor, role ladder, team pages and monthly Gemini meter are implemented. Tests cover the specified caps, provider refusals, exact step lines, company/role/former-person guards, blank-only merges, dismissals, no enrollment, team trust/extraction and meter failures/thresholds. The extra team-card correction is 50ca647. All seven gates pass at the final code revision: 274 app files / 3,494 passed / one skipped, eight wrapper files / 163 passed, root and wrapper TypeScript, production build, whitespace and 29-entrypoint edge typecheck.
4. **MET (artifact); NOT VERIFIED (runtime): Task 6 scoring.** scripts/deepfind-score.sql now accepts :run_ids as uuid[] and prints one row per run, including empty runs, with every requested metric. It reads role_searches_by_provider from result JSON. These counters are provider-interface attempts, including refusals/errors; they are distinct from the monthly dispatched-call meter. Contact/phone facts are current when scored; run readiness comes from saved result JSON with a legacy lead fallback. The existing scorer's two-channel meaning is retained: ready email, phone and person LinkedIn. SQL was not executed.
5. **MET: limits.** No push, merge, deployment, migration/audit execution, VPS change, real search-engine/LinkedIn/Microsoft/SMTP/Gemini request, image/package download, install, spending or secret read. Kevin separately approved official SearXNG documentation/public registry metadata reads; those verified the pinned image. No vault edit/sync occurred.

## Commits and gates

| Item | Commit | App files / passed tests | Wrapper files / passed tests |
| --- | --- | --- | --- |
| Fix A | 661da25 | 267 / 3,373 | 6 / 143 |
| Fix B | cf6006e | 267 / 3,383 | 7 / 149 |
| Plan cherry-picks | 52064dc, 9d2fe4f | Docs only, inherited passing code | Inherited passing code |
| Task 1 | 83961da | 267 / 3,383 | 8 / 163 |
| Task 2 | 10adcd2 | 267 / 3,391 | 8 / 163 |
| Task 3 | 4a6642a | 268 / 3,422 | 8 / 163 |
| Task 4 | ce24176 | 269 / 3,425 | 8 / 163 |
| Task 5 | 8597833 | 271 / 3,460 | 8 / 163 |
| Task 5b | 9741704 | 272 / 3,478 | 8 / 163 |
| Task 5c | 3039cc5 | 274 / 3,492 | 8 / 163 |
| Team-card fix | 50ca647 | 274 / 3,494 | 8 / 163 |
| Task 6 | Commit containing this report | 274 / 3,494 | 8 / 163 |

Every application run above also has one skipped test and zero failures at the commit gate. All seven required gates passed before each implementation commit. TypeScript, build, whitespace and the 29-entrypoint edge shim passed; the build retains its existing large-chunk warning. Environment: VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. Final logs: .superpowers/stage2-final-*.log; prior phase logs and the ledger are also retained locally. These are ignored scratch artifacts, not portable report attachments.

## Changed existing assertions and fixture maintenance

Part 1 assertion changes are fully listed in the appended verifier report: the 075 audit's late-enqueue/expiry/recovery fixtures; recovery expiry now ages finished_at; saved Microsoft company rows expect SMTP; Microsoft catch-all role rows expect SMTP; wrapper abort expects timeout; the approved queue reserve changes the recovery deadline to 85,000 ms. Queue fixtures include created_at. All other existing planQueue cases pass unchanged.

Stage 2 existing assertion changes are limited to: Task 2 adds worker_search to exact resource/default/mapping expectations; Task 5 drops secretary Mary from the registry list while retaining director John. No existing assertion changed for Tasks 1, 3, 4, 5b, 5c or the final card fix. Typed email precheck fixtures gain the new search method. Existing Firecrawl/phase-one suites default only the new role ladder to an empty fixture, preserving their original checkpoint assertions; new engine fixtures verify actual merge, dismissal, insertion and team wiring. The insert fixture now models PostgREST returning only inserted rows. Pure rules and transport tests were observed failing before their implementations; the engine count and final card defects also had failing reproductions before their fixes. SQL audits were authored, not run, so no database TDD claim is made.

## Wiring decisions and remaining limits

- Kevin resolved the fallback conflict: unreachable is included as Task 5 specifies. The fixed table and Task 5 originally disagreed.
- Kevin approved 48-second queue SMTP calls and a 55-second final reserve; the existing 33-second edge timeout would otherwise abort before the wrapper's new 45-second timeout. First-pass timing remains unchanged.
- 076 also replaces finish with the same signature/access rules to atomically restore the claimed attempt on domain_stalled. Repeating finish cannot refund twice. No table schema was added for this.
- Registry records are fetched early for domain evidence, but contact insertion waits for the role result. The three-officer ceiling is cumulative across later registry evidence passes. The exact step-line formatter lives in roleSearch.ts, avoiding a duplicate in deepFindRules.ts.
- Team-page URL provenance reuses existing phone-page captures. The extractor performs no fetches. Team picks consume the two slots first; fallback picks still permit the ladder even if they fill both slots, following the explicit fallback rule. Normal discovery never restores dismissed contacts; existing explicit Start fresh does.
- Profile role fields are optional in frontend compatibility types, while database columns have the exact NOT NULL/default schema. Markdown imports retain their existing text format and do not erase roles. Generic 050 guards and 053 defaults already cover both new provider sources; existing grants/policies were not rewritten.
- The monthly meter uses the key resolver's actual source for counts. Snapshot display mode follows current org configuration: shared fallback enabled and no configured org Gemini key. Counts are approximate application-call counts, including network failures after dispatch, not Google's billable query count. Meter failures never block work; the existing run AI cap still does.
- SearXNG needs its separate outbound network alongside internal search-link; an internal-only container cannot reach engines. No port is published. The documented non-root startup uses UID/GID 977, no added capabilities, readonly config and a cache tmpfs. The wrapper breaker is process-local and resets on restart.
- Browser setup and discovery returned no available browser. UI event-handler and lazy-hook fixtures pass, but visual/mobile/theme checks remain unverified. Docker and a local YAML parser are unavailable. No container or Compose runtime check ran. Source/metadata inspection is not a startup proof.

## Redeploy surface (proposal only)

Static recursive relative-import graph from cf6006e through the final code, including dynamic relative imports and conservatively retaining type-only paths, gives this Stage 2 union:

- check-replies
- check-sequences
- draft-linkedin-message
- draft-reply
- email-settings
- enrich-apollo
- enrich-hunter
- enrich-leads-bulk
- find-decision-makers
- generate-email
- org-api-settings
- parse-csv-leads
- parse-icp
- parse-notes
- parse-session-notes
- run-deep-find
- run-lookup-jobs
- run-selected-autopilot
- run-verify-queue
- scrape-companies-house
- scrape-cro
- scrape-google-places
- send-email
- suggest-sequence

Also required after review/authorization: frontend, wrapper image, worker/docker-compose.yml and worker/searxng/settings.yml; apply reviewed migration 076 before 077 if 076 is not already applied. This 24-function list also covers the Part 1 union. It is a conservative source import graph, not a claim that every function's runtime behavior changed. No deploy was performed. Local graph evidence is .superpowers/stage2-redeploy-graph.json.

## Exact rollout sequence for Claude (not executed)

Each live step needs Kevin's separate authorization after review. Keep operations in Dreamlabs' own accounts. Never restart or modify n8n, Postiz or unrelated services.

1. Take a fresh Hostinger snapshot of VPS 1726663. Snapshots expire after 24 hours and a new snapshot replaces the old one. Record its ID and time before changing anything.
2. Read-only on the VPS: in /opt/lookup-worker run docker compose ps, docker compose config --services and docker stats --no-stream. Confirm the active stack, wrapper image and headroom. Do not print docker compose config or .env: they can expose secrets.
3. Preserve the current compose file, wrapper/src and wrapper image ID in a timestamped backup outside the build context. Prepare the reviewed release payload under /opt/lookup-worker-release. Only replace docker-compose.yml, wrapper/src and the new searxng/settings.yml from the reviewed worker tree; preserve the live .env and every unrelated file. Keep worker/searxng/NOTICE.md with the release record. Both manifests and source must come from the same reviewed revision.
4. Add SEARXNG_SECRET through the existing VPS secret workflow, without printing it or storing it in Git/vault. Keep .env mode 600. VERIFY_TIMEOUT_MS may be absent for the 45,000 ms default, or explicitly 45000. Preserve Reacher RCH__SMTP_TIMEOUT=30 and existing secrets.
5. In /opt/lookup-worker run, in order: docker compose config --quiet; docker compose pull searxng; docker compose build wrapper; docker compose up -d --no-deps searxng wrapper. Do not use compose down or recreate the whole stack. Check docker compose ps searxng wrapper and inspect their logs without dumping environment/configuration values.
6. Verify searxng has no host bindings with docker inspect of the container returned by docker compose ps -q searxng, formatting only .HostConfig.PortBindings. Inspect lookup-worker_search-link membership: only wrapper and searxng should be present. Confirm the wrapper can reach SearXNG internally. Check /health and guarded refusal behavior first. Real search queries or SMTP/Microsoft validation require Kevin's explicit authorization; never fetch LinkedIn profiles. Verify hash-only wrapper logs and image startup as separate runtime checks. No promise of engine throughput is made from fixture tests.
7. Claude reviews 076/077 and the audits, performs separately authorized rolled-back dry runs, confirms rollback, then applies each reviewed migration on Kevin's authorization. Audits are disposable-fixture scripts; do not run them in a database with active queue work. Grant/RLS/month-boundary/concurrency checks remain pending until this review. 077 is one accumulated file, not four migrations.
8. Deploy the function union above from the same reviewed revision. Merge/push/frontend publication require Kevin's explicit authorization; main auto-deploys the frontend. Do not seed guessed role values. Kevin supplies/approves profile roles described by the spec.
9. On separately authorized fixture/live test scope, re-run the same 50 leads, wait for queue completion, and execute scripts/deepfind-score.sql with the approved run UUID list. Compare by run, not by pipeline. Inspect the real engine throttle rate, result-title shapes, timeout/stall recovery, meter sharing and the previously unverified UI on phone width.
10. Roll back application/container changes by restoring the saved wrapper source/image and compose file, recreating only wrapper, and stopping only the added SearXNG container if required. Preserve additive database rows and counters; do not drop 077 tables or contacts as an automatic rollback. Any database rollback needs its own reviewed plan and Kevin's authorization.

## Not verified and handoff

No SQL migration, audit or scorer ran. Real RLS/grants, London month boundaries, PostgREST contention and EdgeRuntime lifecycle are unverified. No browser/mobile/theme or Docker runtime check ran. No real engine, Gemini, LinkedIn, Microsoft, Reacher/SMTP or production scoring ran. Provider throttling, free-allowance billing and startup compatibility remain runtime questions. Independent Claude review is pending. Subscription usage is unavailable; no paid fallback was used.

Open docs/HANDOFF.md, this report and the appended verifier report at the exact final branch tip. Review both branches and migrations 076/077 before proposing rollout. The authorized builder work ends at Task 6; deployment, SQL, provider tests, merge/push and role seeding remain unauthorized.

---

## Historical build milestones (superseded by the final result above)


## Milestone (2026-11-16)

Worktree: C:/Users/kevin/Projects/dreamlabs-sales-verifier-v2. Codex is builder; Claude is architect/reviewer. Independent review pending. Kevin approved local build only. Part 1 branch codex/verifier-v2-defects ends at cf6006e (Fix A 661da25; Fix B cf6006e). Stage 2 branch codex/stage2-people starts there and cherry-picks the plan as 52064dc and 9d2fe4f. Original plan commits: 7581e0d,174832c.

Task 1:83961da; Task 2:10adcd2; Task 3:4a6642a; Task 4:ce24176. Task 5 is the commit carrying this milestone. Tasks 5b,5c,6 remain authorized and unfinished. Full task ledger: .superpowers/sdd/2026-11-16-deep-find-stage2-people/progress.md; exact briefs, bases and local verification logs are saved there. Gate logs are .superpowers/stage2-<task>-*.log. These scratch files are local and ignored; this report and Git commits are the durable record.

| Task | App files / tests passed | Wrapper files / tests passed | Other gates |
| --- | --- | --- | --- |
| 1 | 267 /3383, one skipped | 8 /163 | TypeScript, build, whitespace, edge29, wrapper TypeScript PASS |
| 2 | 267 /3391, one skipped | 8 /163 | All PASS |
| 3 | 268 /3422, one skipped | 8 /163 | All PASS |
| 4 | 269 /3425, one skipped | 8 /163 | All PASS |
| 5 | 271 /3460, one skipped | 8 /163 | All PASS |

Task 1 adds the bounded secret-guarded search route and digest-pinned SearXNG service. Docker and a local YAML parser are unavailable; no container ran. Approved official documentation and registry metadata reads verified tag/digest/non-root configuration; references are in worker/searxng/NOTICE.md. Search engines were never contacted. SearXNG gets a private wrapper link plus a separate outbound network, required for engines; no published ports, UID977, no added capabilities, 512MiB/0.5CPU.

Task 2 adds worker_search, its reserve/refund client method and labels. Search found the UI labels in shared USAGE_TEXT, consumed by UsageMeter and UsageLimitsCard. Migration059 has an enumerating CHECK only on usage_resources; 077 widens it. The three consumer resource columns use FKs and need no CHECK rewrite. The new audit tests400/401 and1200/1201 and client write refusals, written only.

Task 3 adds the fixed ladder and conservative result judge, with31 fixtures covering current-company/current-role proof, former employees, misleading hosts, name parsing, queries and caps. Pathological company/city-only queries get a final300-character bound after all trailing roles have been dropped.

Task 4 adds profile role arrays and editor fields. Search found useIcps and IcpEditor as the editor path, candidateSource.ts as the contact label map. Generic050 insertion/immutability rules and053 default already cover new sources, so no grant/policy/trigger rewrite was needed. Runtime provider lists now include role_search. Ordinary discovery never revives dismissed people; existing explicit Start fresh restoration includes the new provider. Markdown import retains its existing supported text sections and does not overwrite roles. The UI event-handler harness proves saved arrays; browser runtime and discovery reported no available browser, so visual/mobile checks remain unverified. Local fixture dev server was stopped.

Task 5 adds SearXNG-first fallback, run-cap reservations, role ladder and blank-only contact merges through prepareContacts/applyDeepFindBlank. Kevin explicitly ruled unreachable is a fallback case, resolving the fixed-table/Task5 conflict. Registry people remain available for domain evidence, but contact inserts wait for the role result and are cumulatively capped at3 after a hit. New role contacts are never enrolled. Stable role ordering precedes input caps, first-pass importance groups and queue priorities. Result JSON role_searches_by_provider counts provider-interface attempts, including refusals/errors, separately from billing. Step backup suffix survives a failed Gemini attempt. Exact step-line formatter lives in roleSearch.ts rather than duplicated in deepFindRules.ts.

Changed existing assertions so far: Task2 adds worker_search to exact USAGE_DEFAULTS/USAGE_RESOURCES/WORKER_RESOURCE maps. Task5 registry-officer expectation drops Mary (secretary), retaining John. Other existing assertions are unchanged. Typed email precheck fake gains search; old engine suites default the new ladder to an empty fixture, preserving their checkpoint assertions. New engine fixtures prove merges, dismissal and inserts/counts without loading real providers. All logic tests were written first and observed failing at the absent behavior/module; engine integration checks add coverage of the wired path, with the missing result count observed red before its fix.

Unverified: SQL/audit execution, real locks and RLS, Deno, browser/mobile, Docker/Compose runtime, real engines/LinkedIn/Gemini/Microsoft/SMTP, live latency, production scoring and independent review. Nothing was pushed, merged, deployed or applied. No VPS change, provider request, image/package download, installation, paid fallback, spending, secret read or vault sync. Approved external reads were git fetch plus official SearXNG documentation/public registry metadata. Rollout details and final redeploy graph will be completed in Task6.


## Task 5b milestone

Task5 commit:8597833. Task5b is the commit carrying this section. Sixteen pure fixtures and two real-engine wiring fixtures pass. All seven gates pass:272 files /3478 app tests plus one skipped; wrapper8 files /163; edge29. No existing assertion changed. HTML extraction is import-free, JSON-LD-first and capped at12 per page, with adjacent name/title cards, same-card LinkedIn links, sentence/ancestor/company exclusions and exact domain/path trust guards. Reuses captured fetchedPhonePages and discovery phonePages; no new fetches. Target team hits skip the ladder; fallback team hits still search and occupy the shared two slots first. Source team_page uses the same prepared-contact and blank-fill path, default no enrollment, generic guard and new label. The rollback audit covers client INSERT refusal, provider guard and the false enrollment default, written only.


## Task 5c milestone

Task5b commit:9741704. Task5c is the commit carrying this section. Central grounded-call counting covers actual dispatch completion, including provider/network errors, while missing keys and nonpositive local timeout make no request/count. Count errors log only gemini_search_count_failed and never fail the lookup. Source comes from resolver onSource callbacks, not key inspection. Context propagates through all six search call sites found by rg: knownPersonLookup person/company/format, leadResearch, registryWebProof, and DeepFind role fallback. Their caller paths include DeepFind/domainDiscovery/deepFindPeople, knownPersonFlow/find-decision-makers and selectedLeadPipeline/load. No extra count occurs in wrappers, so one dispatched grounded call increments once.

077 now includes the exact monthly table, RLS, service-only atomic count RPC and member snapshot RPC. Month uses Europe/London. Snapshot has only three keys (org_searches,shared_key,shared_searches), and shared_searches is a number or null, never another org's rows. Current shared-key mode is fallback enabled without a configured org Gemini key; actual counts use the resolver source. No existing RLS policy/grant was loosened. The counter is informational and cannot refuse searches. UI loads it once on first open, ignores stale org responses and uses warning/danger tokens at4000/5000. UsageMeter remains under150 lines. Counting is per dispatched application call, including network failures; it does not prove Google received/billed the request or count Google's internal queries.

Twelve meter tests and two lazy-hook tests were written and observed red before implementation, then green. Pre-format gates all passed:274 files/3492 app tests plus one skipped, wrapper8/163, edge29, both TypeScript/build/whitespace. Final gates before the commit are in .superpowers/stage2-5c-*.log. No existing assertion was changed. Audit cases for count0/21, client writes/execution, foreign-org isolation, shared numeric-only totals and own-key mode are written only. Browser/mobile, database RPC/RLS and real monthly/provider counts remain unverified.


## Final author review — team-card correction

Task5c commit:3039cc5. Two additional fixtures exposed social-link text inside a nested role container and a same-card LinkedIn anchor placed before the heading. The separate fix commit carrying this section excludes anchors from title text and reads all links in a single-person card; multi-person containers retain segmented link selection. Both fixtures failed first, then passed. Every gate passed again:274 files/3494 app tests plus one skipped; wrapper8/163; edge29. No existing assertion changed. This is author verification, not Claude's independent review.


## Session-close verification (2026-11-16)

Kevin requested a positive-difference check and project/shared-context updates after build/report commit 2a018da. See docs/STAGE2-POSITIVE-DIFFERENCE-CHECK.md for three fresh side-by-side fixture comparisons against 8c1c61b and the closing verification. Application code is unchanged. Local improvements are established; live scores remain unchanged/unmeasured, and independent review and runtime validation remain pending. Vault updates are now authorized and stored as a labelled branch checkpoint, preserving the accepted-main mirror.

## Review fixes

2026-11-16. Kevin authorized seven local review fixes on codex/stage2-people, starting at 4c648e8 (Claude reviewed 2a018da; later closeout changes were documentation only). Codex builds; Claude reviews. No network, provider, SQL, VPS, installation, spending, push, merge or deployment is authorized. Each fix uses a failing fixture before production edits and all seven gates before its explicit-path commit. Independent review of these fixes remains pending.

### Fix 1 — company evidence

Both quoted longer-company fixtures failed first (accepted instead of company_mismatch), then passed. Company matching now inspects the title company part or individual Experience/at snippet evidence and refuses extra distinctive words. Legal and lead city/country words are excluded; city/country reach the judge through the engine. The existing accepted fixtures remain accepted. Changed existing assertion: the Other Employer title with an Acme Experience snippet now returns company_mismatch instead of former, because current-title company evidence takes precedence. Historical date ranges still return former.

Gates: 274 app files / 3,497 passed / one existing skipped; 8 wrapper files / 163 passed; root and wrapper TypeScript, build, whitespace and 29-entrypoint edge typecheck PASS. Logs: .superpowers/review-fix1-*.log. Commit: the fix commit containing this entry (exact hash recorded in the final review-fix ledger).

### Fix 2 — role evidence and saved title

The quoted Sam Lee fixture and Jane Doe fixture failed first. Snippet-only roles now require same-segment role-at/@/comma-company evidence; sentence, semicolon, pipe and middle-dot boundaries prevent unrelated roles from qualifying. A matching title role keeps its title part; otherwise the exact matched ladder role is saved. The company name never supplies the saved title. All four new fixtures pass, including all three separators. No existing assertion changed.

Gates: 274 app files / 3,501 passed / one existing skipped; 8 wrapper files / 163 passed; all other five gates PASS, edge29. Logs: .superpowers/review-fix2-*.log. Fix 1 commit: 759e02d.

### Fix 3 — name parsing

The quoted credential and dotted-initial fixtures failed first; an undotted-initial fixture also exposed the wrong saved surname. Name parsing now drops the comma suffix and single-letter initials before the existing two-to-four-word and letter validation. All three pass. No existing assertion changed.

Gates: 274 app files / 3,504 passed / one existing skipped; 8 wrapper files / 163 passed; all other five gates PASS, edge29. Logs: .superpowers/review-fix3-*.log. Fix 2 commit: 5f9feb8.

### Fix 4 — saved-data read failures

Both real-engine fixtures first returned failed. They now emit exactly "Role search: skipped, could not read saved data.", save neither team nor role people, and continue to add all four fixture officers without the role-hit ceiling. Saved contacts are read once before any role/team writes, avoiding a later read failure after an earlier role save. Checkpoints still guard each write and their existing ordering is preserved. The fixture database now supports officer insert and one-shot scoped read errors; default role/officer mocks are reset between tests. No existing assertion changed.

The first full run caught seven checkpoint-order regressions from an unnecessary extra read checkpoint. It was removed; the focused 76 tests and all seven gates then passed. Final gates: 274 app files / 3,506 passed / one existing skipped; 8 wrapper files / 163 passed; both TypeScript, build, whitespace and edge29 PASS. Logs: .superpowers/review-fix4-final-*.log (initial failed run retained as review-fix4-tests.log). Fix 3 commit: 66d1062.

### Fix 5 — empty-result fallback once per lead

The three-empty-rung fixture first reserved three AI units instead of one. The per-lead provider now tracks only empty-result fallback use and returns none on later empty rungs before reserving AI. Busy/throttled, not_configured and unreachable fallback paths remain independent. New tests prove three engine rungs reserve once, later empty calls return none, a new lead gets its own allowance, and a throttled second rung after an empty first still reserves and falls back. No existing assertion changed.

Gates: 274 app files / 3,508 passed / one existing skipped; 8 wrapper files / 163 passed; all other five gates PASS, edge29. Logs: .superpowers/review-fix5-*.log. Fix 4 commit: 90bd726.
