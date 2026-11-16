# Deep find Stage 2 people — local build report

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
