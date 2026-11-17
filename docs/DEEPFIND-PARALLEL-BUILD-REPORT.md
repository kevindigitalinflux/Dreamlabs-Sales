# Deep find parallel processing, fair turns and run quality

## Result and scope

Local build on codex/deepfind-parallel, fetched base d1bad26de090285e1afa65bed1b04e5d40d16da0. Kevin directs, Claude architects/reviews, Codex builds. Ten tasks are authorized, one commit per task with all seven gates. Migration 078 is written only; no SQL, provider request, deployment, push/merge, VPS change, installation or spending is authorized. Independent review and live concurrency remain unverified.

Claude's brief-execution hook was read and manually invoked with a UserPromptSubmit task event. It returned BUILD BRIEF DETECTED. Automatic lifecycle interception was not established, and hook/trust configuration was not changed. The brief-execution report rules are followed. The other discovered fable-mode skill was inspected to identify the requested runbook, not silently activated.

## Task 1 — concurrency audit before parallel changes

| Shared write / source | Decision and SQL reasoning |
| --- | --- |
| deep_find_reserve / increment (057), Spend | Safe cap arithmetic: single conditional UPDATE locks the run row and rechecks ceilings on contention. Local Spend is lead-local and not the global authority. |
| gemini_search_count (077) | Safe informational UPSERT adds to the current row, not a stale client count. It is not admission control; Task 4 adds the shared minute guard. |
| usage_reserve / refund (059), worker client | Safe quota arithmetic: global then org row locks in fixed order; refusal is fail closed; one client refund per refused dispatch. Worker 429/limit behavior and run-wide messaging are checked in Task 4. |
| check queue inserts / claims / finish (075/076) | Safe dedupe and bounded claims: run-scoped lock plus UNIQUE(run_id,address,kind), queue row SKIP LOCKED, domain advisory transaction lock. Finish only changes running rows; stalled refund is conditional. |
| completeIfDone | Needs fix: count-then-update can complete a newly created run before its lead rows exist. 078 adds a single conditional UPDATE requiring all lead_count rows and no open rows. Engine delegates to that service-only RPC. |
| housekeeping / stuck requeue | Needs fix: a client snapshot can act on a newer running claim. 078 tests status and the ten-minute stale timestamp in the same UPDATE on the current locked tuple. Engine delegates recovery to SQL. Requeue-once/fail-after-two semantics are preserved. |
| run result / RunVerifyGate / registry proof allowance | Existing whole-JSON CAS preserves concurrent _verify_gate and _registry_proof with a version increment (runVerifyGateStore, registryProofAllowance). Conditional SQL writes retry rather than overwrite shared JSON. Runtime lock contention remains untested. |
| lead blank fills / lead domain append | Safe scoped compare-and-set and additive RPC; no nonblank field replacement. Membership/edit/cancel checks remain. |
| contacts / LinkedIn records | One open Deep find lead globally via partial unique index (057); provider contact upsert uses lead_id,dedupe_key and ignoreDuplicates. Blank contact writes use scoped old values. Queue overlap uses the existing blank-fill safeguards. |
| lead claim (057) | Safe exclusive queued-row claim with SKIP LOCKED and unique open lead; fairness under simultaneous invocations needs the SQL serialization/ordering in Task 3. |
| Places context / quota (067, placesClient) | Context/probe cache is invocation-local; independent invocations may repeat a free probe. Paid monthly admission/refund is SQL-locked and reservation-id guarded. In-memory context never authorizes over the quota. Places caps are unchanged. |
| new global minute guard / run refusal / notices | Not present in baseline. Tasks 4 and 6 add SQL atomic admission, monotonic run refusal and once-per-run notice claims, not code locks. |

The lead engine has a 120-second budget within a 130-second invocation budget; stale recovery uses ten minutes. Actual platform termination and an overlapping live claim need runtime verification. This audit does not claim that fixtures prove PostgreSQL scheduling or production latency.

Two local RPC contract tests were red at the absent maintenance module, then passed. The existing tick fixture accepts the new RPCs without changing its assertions. SQL reasoning is source review, not an executed database test. All seven gates PASS: 277 app files / 3,621 passed / one existing skip; wrapper 8 files / 166 passed; root/wrapper TypeScript, build, whitespace, edge29. Logs .superpowers/parallel-task1-*.log. Task 1 is the commit containing this initial report.

## Pending tasks / outside gates

Tasks 2–10 follow. Migration dry-run SQL, fairness and sized-backstop fixtures will be included in this report; none is executed locally. With the existing 50-lead maximum, the exact Task 5 formula remains three hours at every allowed parallelism. This was reported before building; the formula is retained rather than changing lead caps.

## Not verified

Real database concurrency/RLS/cron/pg_net, container/provider calls, production quality and independent review. All live observations in the brief were supplied by Kevin/Claude, not read in this session. No live operation occurred. Subscription usage is unavailable; milestones are saved per task.
