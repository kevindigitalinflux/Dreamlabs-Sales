# Deep find parallel processing, fair turns and run quality

## Result and scope

Local build on codex/deepfind-parallel, fetched base d1bad26de090285e1afa65bed1b04e5d40d16da0. Kevin directs, Claude architects/reviews, Codex builds. All ten tasks are locally built, one commit per task with all seven gates passing. Migration 078 is written only; no SQL, provider request, deployment, push/merge, VPS change, installation or spending is authorized. Independent review and live concurrency remain unverified.

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

## Initial Task 1 checkpoint / outside gates

At the initial checkpoint Tasks 2–10 remained. Their subsequent results and migration dry-run SQL follow below; no SQL was executed locally. With the existing 50-lead maximum, the exact Task 5 formula remains three hours at every allowed parallelism. This was reported before building; the formula is retained rather than changing lead caps.

## Not verified

Real database concurrency/RLS/cron/pg_net, container/provider calls, production quality and independent review. All live observations in the brief were supplied by Kevin/Claude, not read in this session. No live operation occurred. Subscription usage is unavailable; milestones are saved per task.

## Task 2 — parallel cron invocations

078 now creates a service-only/RLS runtime config row, deep_find_parallel default 3 bounded 1..5. The existing cron name is replaced in place at the unchanged */2 schedule; generate_series produces one net.http_post per configured invocation. Headers and the Vault lookup for cron_secret remain identical, with no inline secret. Each engine invocation still claims max_leads=1 serially. No cron or SQL ran. A defensive parallelism reader is tested for default/bounds and will also be used by the edge backstop. Migration has no outer transaction so it can be included safely inside the report's rolled-back dry run.

Gates: 278 app files / 3,622 passed / one existing skip; wrapper 8 /166; both TypeScript/build/whitespace/edge29 PASS. Logs parallel-task2-*.log. Task 1 commit d301d94; Task 2 is this entry's commit. SQL runtime is NOT VERIFIED.

Dry-run entry point (psql, disposable migrated database only, never executed by Codex):

```sql
BEGIN;
-- psql: \ir ../supabase/migrations/078_deep_find_parallel.sql
-- In SQL Editor, paste the entire 078 body here instead of the psql include.
DO $$ BEGIN
 ASSERT (SELECT deep_find_parallel=3 FROM public.deep_find_runtime_config WHERE singleton);
 BEGIN UPDATE public.deep_find_runtime_config SET deep_find_parallel=0; RAISE EXCEPTION 'missing lower bound';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deep_find_runtime_config SET deep_find_parallel=6; RAISE EXCEPTION 'missing upper bound';
 EXCEPTION WHEN check_violation THEN NULL; END;
 ASSERT NOT has_table_privilege('authenticated','public.deep_find_runtime_config','UPDATE');
END $$;
ROLLBACK;
```

## Task 3 — fair claims

The service-only claim RPC locks the singleton config row before selecting a lead. Each subsequent SQL statement sees committed running counts; each loop iteration also sees its own prior claim. Ordering is running count, run start, queued timestamp, ID. The short transaction lock serializes admission only, not lead processing; SKIP LOCKED and the ten-row ceiling remain. This avoids simultaneous equal-count snapshots choosing the same oldest run. Live PostgreSQL scheduling is not verified.

The new SQL contract test was red before the function existed. Its first gate failed because a TypeScript test imported node:fs outside the app's configured types; the test was moved to JavaScript, with no product change. All seven gates then passed: 279 app files / 3,623 passed / one existing skip; wrapper 8 / 166; edge 29. Logs parallel-task3-*.log. No existing assertion changed. Task 2 commit 300f9eb; Task 3 is this entry's commit.

## Task 4 — shared rate guards and daily notices

Every Gemini transport, grounded and JSON, now requires the service-only gemini_admit RPC before HTTP. The SQL minute primary key plus conditional UPSERT admits at most the configured 12 calls per database minute across all invocations and keys. Missing config/RPC failure fails closed as busy. Non-Deep-find calls use the existing server service-secret environment through a five-second RPC request; no new secret path is introduced. Monthly counters count only dispatched calls. Role search reports busy; other web steps retain the existing safe 429 message and continue.

Worker quota/refund RPCs remain authoritative. Busy/limit/domain-stalled refusals no longer consume domain starts/canary or the per-lead SMTP allowance. Run Hunter/AI caps are not reserved by worker calls. Daily usage refusals atomically claim one notice per run/resource; later leads suppress that repeated line. SQL failure suppresses repeat notices and emits a fixed diagnostic.

New admission/worker/domain-state tests were observed red before implementation. Existing assertion changed: the search-provider HTTP 429 case now expects busy instead of failed. Existing known-person, monthly-meter and drafting transport fixtures mock successful admission; their behavioral assertions are unchanged. First full test gate exposed those fixtures and the intended 429 assertion; after updates all seven gates pass: 280 app files / 3,629 passed / one existing skip; wrapper 8 /166; edge29. Logs parallel-task4-*.log. Task 3 commit 746e8c1. SQL atomicity is reasoned, not executed.

## Rolled-back migration and SQL checks (written, NOT EXECUTED)

Run only against an empty disposable database with migrations through 077. The migration has no transaction boundary; include it inside this transaction. A raised assertion requires an explicit ROLLBACK. This does not prove simultaneous PostgreSQL scheduling; overlapping sessions and one real run remain required after approval.

```sql
BEGIN;
-- psql, from the repository root:
-- \i supabase/migrations/078_deep_find_parallel.sql
-- SQL Editor: paste the full 078 body above the following DO block.
DO $$
DECLARE owner_id uuid:=gen_random_uuid(); org uuid; pipe uuid;
 a uuid; b uuid; lead uuid; queued uuid; picked uuid; i integer; signature text; client_role text;
BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.deep_find_runs WHERE status='active'), 'Empty disposable runs required';
 ASSERT NOT EXISTS(SELECT 1 FROM public.deep_find_check_queue), 'Empty disposable queue required';
 ASSERT (SELECT deep_find_parallel=3 AND gemini_per_minute=12 FROM public.deep_find_runtime_config WHERE singleton);
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 VALUES('00000000-0000-0000-0000-000000000000',owner_id,'authenticated','authenticated','parallel-audit@example.test','',now(),'{}','{}',now(),now());
 INSERT INTO public.organizations(name,created_by) VALUES('Parallel audit',owner_id) RETURNING id INTO org;
 INSERT INTO public.org_members(org_id,user_id,role) VALUES(org,owner_id,'admin');
 INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(org,'Parallel audit',false,owner_id) RETURNING id INTO pipe;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 INSERT INTO public.deep_find_runs(org_id,created_by,lead_count,started_at) VALUES(org,owner_id,2,now()-interval '2 minutes') RETURNING id INTO a;
 INSERT INTO public.deep_find_runs(org_id,created_by,lead_count,started_at) VALUES(org,owner_id,2,now()-interval '1 minute') RETURNING id INTO b;
 ASSERT NOT public.deep_find_complete(a), 'A run cannot complete before its lead rows exist';
 FOR i IN 1..4 LOOP
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by) VALUES(org,pipe,'Parallel fixture '||i,owner_id) RETURNING id INTO lead;
  INSERT INTO public.deep_find_leads(org_id,run_id,lead_id) VALUES(org,CASE WHEN i<=2 THEN a ELSE b END,lead);
 END LOOP;
 SELECT run_id INTO picked FROM public.deep_find_claim(1); ASSERT picked=a;
 SELECT run_id INTO picked FROM public.deep_find_claim(1); ASSERT picked=b;
 SELECT run_id INTO picked FROM public.deep_find_claim(1); ASSERT picked=a;
 SELECT run_id INTO picked FROM public.deep_find_claim(1); ASSERT picked=b;
 ASSERT NOT EXISTS(SELECT 1 FROM public.deep_find_claim(0));
 ASSERT public.deep_find_check_deadline(now(),50,1)=now()+interval '3 hours';
 ASSERT public.deep_find_check_deadline(now(),300,3)=now()+interval '260 minutes';
 ASSERT public.deep_find_check_deadline(now(),1000,1)=now()+interval '8 hours';
 ASSERT (SELECT deep_find_parallel=3 FROM public.deep_find_runs WHERE id=a);
 UPDATE public.deep_find_runtime_config SET deep_find_parallel=1 WHERE singleton;
 ASSERT (SELECT deep_find_parallel=3 FROM public.deep_find_runs WHERE id=a), 'Snapshot changed';
 BEGIN UPDATE public.deep_find_runtime_config SET deep_find_parallel=0; RAISE EXCEPTION 'Missing lower bound'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.deep_find_runtime_config SET deep_find_parallel=6; RAISE EXCEPTION 'Missing upper bound'; EXCEPTION WHEN check_violation THEN NULL; END;
 DELETE FROM public.gemini_minute_usage;
 FOR i IN 1..12 LOOP ASSERT public.gemini_admit(); END LOOP;
 ASSERT NOT public.gemini_admit(), 'Thirteenth call admitted';
 SELECT lead_id INTO lead FROM public.deep_find_leads WHERE run_id=a LIMIT 1;
 UPDATE public.deep_find_runs SET started_at=now()-interval '70 minutes' WHERE id=a;
 INSERT INTO public.deep_find_check_queue(org_id,run_id,lead_id,address,domain,kind)
 VALUES(org,a,lead,'backstop@fixture.test','fixture.test','smtp') RETURNING id INTO queued;
 ASSERT (SELECT count(*)=1 FROM public.deep_find_checks_claim(1)), 'Late enqueue should be claimable';
 UPDATE public.deep_find_check_queue SET status='queued',created_at=now() WHERE id=queued;
 UPDATE public.deep_find_runs SET started_at=now()-interval '181 minutes' WHERE id=a;
 ASSERT NOT EXISTS(SELECT 1 FROM public.deep_find_checks_claim(1)), 'Run backstop failed';
 PERFORM public.deep_find_checks_expire();
 ASSERT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE id=queued AND status='skipped' AND reason='run_time_limit');
 UPDATE public.deep_find_runs SET status='cancelled',started_at=now() WHERE id=a;
 UPDATE public.deep_find_check_queue SET status='running',created_at=now(),claimed_at=now() WHERE id=queued;
 PERFORM public.deep_find_checks_expire();
 ASSERT EXISTS(SELECT 1 FROM public.deep_find_check_queue WHERE id=queued AND status='skipped' AND reason='run_time_limit');
 UPDATE public.usage_resources SET default_org_limit=400,global_limit=1600 WHERE resource='worker_scrape';
 ASSERT (SELECT default_org_limit=400 AND global_limit=1600 FROM public.usage_resources WHERE resource='worker_scrape');
 ASSERT public.deep_find_notice_once(a,'worker_scrape');
 ASSERT NOT public.deep_find_notice_once(a,'worker_scrape');
 FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  ASSERT NOT has_table_privilege(client_role,'public.deep_find_runtime_config','UPDATE');
  ASSERT NOT has_table_privilege(client_role,'public.gemini_minute_usage','SELECT');
  FOREACH signature IN ARRAY ARRAY['public.deep_find_claim(integer)','public.deep_find_complete(uuid)',
   'public.deep_find_housekeeping()','public.gemini_admit()','public.deep_find_notice_once(uuid,text)',
   'public.deep_find_checks_claim(integer)','public.deep_find_checks_expire()'] LOOP
   ASSERT NOT has_function_privilege(client_role,signature,'EXECUTE');
   ASSERT has_function_privilege('service_role',signature,'EXECUTE');
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
```

## Task 5 — sized run backstop

The exact deadline is started_at plus min(8 hours, max(3 hours, lead_count * 2 minutes / parallelism + 60 minutes)). New runs snapshot parallelism in a service-owned insert trigger; existing runs receive the default three. Queue SQL claim, stale recovery, expiry and edge canStillEdit use the same formula and snapshot. Queue-row sixty-minute windows and recoverProven's finished_at window are unchanged. Tests cover the three-hour floor, scaling and eight-hour ceiling. Counts above today's 50-lead cap test the formula only; lead caps are unchanged.

No existing assertion changed. The SQL block above covers alternating claims, admission, notices, bounds, grants and deadline calculations but was not executed. App fixture tests do not establish SQL validity or concurrency.
Task 5 gates: 281 app files / 3,632 passed / one existing skip; wrapper 8 /166; root and wrapper TypeScript, build, whitespace, edge29 PASS. Logs parallel-task5-*.log. Task 4 commit 29b55b0.

## Task 6 — stop Gemini after key/billing refusal

078 adds a monotonic run column and service-only gemini_run_status RPC. The first 401/402/403 wins under the run row lock. Each grounded or JSON call with a run context reads it before minute admission and HTTP. Research summary JSON now receives that context too. Later leads disable Gemini before reserving ordinary AI work. The engine stores the fixed combined sentence once, and the run page renders one warning from the run column. HTTP 429 never sets the flag. Already dispatched concurrent calls cannot be recalled; calls admitted before the first refusal may finish. An RPC failure refuses new Gemini work rather than bypassing the flag.

A wider transport search found parse-icp and org-api-settings key validation bypassing ai.ts. Their Gemini requests now use the shared minute admission too. This completes Task 4's all-call surface in this commit; no provider request was made. An initial Task 6 gate caught fixture typing and a misplaced SSR test import, both corrected. No existing behavioral assertion changed. Three existing admission mocks now supply the refusal recorder as well.

Tests: 401/402/403 persist across separate lead contexts and prevent a second HTTP request; 429 permits later requests; the engine gives a saved-refusal lead one exact combined line and no Gemini call; SSR renders one warning; source contracts cover the two separate transports. All seven gates PASS: 284 app files / 3,640 passed / one existing skip; wrapper 8 /166; edge29. Logs parallel-task6-*.log. Task 5 commit 7c071cf. Browser rendering and real overlapping request behavior remain NOT VERIFIED.

Additional dry-run assertions inside the preceding DO block, after run a exists (not executed):

```sql
ASSERT public.gemini_run_status(a) IS NULL;
ASSERT public.gemini_run_status(a,402)=402;
ASSERT public.gemini_run_status(a,401)=402;
DECLARE rejected boolean:=false;
BEGIN
 BEGIN PERFORM public.gemini_run_status(a,429);
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 ASSERT rejected, '429 was accepted as a run refusal';
 ASSERT (SELECT gemini_refused_status=402 FROM public.deep_find_runs WHERE id=a);
END;
ASSERT NOT has_function_privilege('anon','public.gemini_run_status(uuid,integer)','EXECUTE');
ASSERT NOT has_function_privilege('authenticated','public.gemini_run_status(uuid,integer)','EXECUTE');
```

## Task 7 — role fallback time budget

The role Gemini adapter uses min(25,000, left minus 5,000) and refuses to dispatch below 20,000 ms remaining. The existing ladder threshold remains unchanged. Four red budget fixtures now cover 120s, 25s, 20s and 19,999ms, and the real engine fixture observes a 25,000ms provider timeout. No existing assertion changed. All seven gates PASS: 285 app files /3,645 passed /one existing skip; wrapper 8 /166; edge29. Logs parallel-task7-*.log. Task 6 commit 605a197. Real model latency remains unverified.

## Task 8 — tolerant grounded JSON

The bounded shared object reader handles JSON lines, multi-line objects, fenced arrays, prose and balanced invalid objects. It respects string escapes and emits an outer object once, without treating nested objects as separate people. Role field validation and company/name/grounding judges are unchanged. The known-person web parser reuses it, still requiring email/profile proof outside all JSON spans; its strict automatic-profile path also reads the same parsed objects.

The zero-person diagnostic adds objects_found, still counts only. lines_parsed keeps its original standalone-JSON-line meaning, so pretty replies can have zero lines_parsed with positive objects_found. Changed existing assertions: the two source-proof engine cases, two normal/interrupted engine shape cases, the rolePeople shape assertion and searchProvider shape assertion add objects_found (one, or two for the two-object fixture). No accepted-person verdict was relaxed.

Red parser fixtures preceded implementation. The first typecheck caught an incomplete edited block and was corrected. One later full run hit Vitest fork startup timeouts; another was interrupted by the server restart. The final fresh full run passes all seven gates: 286 app files /3,656 passed /one existing skip; wrapper 8 /166; edge29. Logs parallel-task8-*.log. Task 7 commit d32461b. Real Gemini reply shape remains NOT VERIFIED; every reply fixture is synthetic/redacted.

## Task 9 — owner/name pairs on trusted pages

Plain prose and footer extraction now recognizes role-first and name-first comma/colon/dash pairs, plus I'm Name with owner-led/founder in the same sentence. The engine supplies the actual role ladder. Only confirmed, non-suspect company domains qualify; no extra fetch or scrape is added. Existing structured/card path eligibility stays unchanged. Script/navigation/testimonial/review/client blocks remain excluded, including nested markup. Explicit foreign company phrases veto the candidate, using the existing company comparator/proof extractor. The shared role judge applies name, former-role and role rules. The trusted website establishes company identity when a footer does not repeat its name.

Six positive fixtures were red before implementation; negatives cover Owner Operated, Owners Club, a third-party testimonial, former roles, company-as-name, nested review markup, wrong domains and roles outside the supplied ladder. A real-engine homepage fixture saves Gary Ramsay as team_page with include_in_sequences false and skips the satisfied target ladder. No existing assertion changed; existing SearXNG judge fixtures pass unchanged.

All seven gates PASS: 287 app files /3,671 passed /one existing skip; wrapper 8 /166; edge29. Logs parallel-task9-*.log. Task 8 commit a5c82f4. Live site extraction and false-positive rate remain NOT VERIFIED.


## Task 10 — scrape cap defaults

USAGE_DEFAULTS.worker_scrape is now orgLimit 400/globalLimit 1600. The idempotent migration UPDATE records those same Kevin-approved production defaults. UsageLimitsCard already uses this constant for its reset label/message and removes the scoped override so usage_snapshot returns the database default; no redundant card implementation change was needed. A red UI-handler fixture now verifies Reset to 400, the scoped override deletion, reload and the 400-per-day confirmation. The existing agreed-caps assertion changes only worker_scrape from 100/400 to 400/1600. Old snapshot/reservation fixture values remain arbitrary response data, not stale defaults. Firecrawl's 100-page cap, Places shared 900 and places_usage_limits are unchanged.

## Acceptance evidence

1. Task 1 audit and unsafe maintenance: MET for source changes and local fixtures; the audit table lists every requested write. SQL execution/concurrency: NOT VERIFIED.
2. Task 2 parallel cron: MET as a written migration, default three/bounds one through five, Vault secret lookup and unchanged two-minute schedule. Cron/runtime: NOT VERIFIED.
3. Task 3 fair claims: MET as SQL ordering, short transaction lock, SKIP LOCKED and ten-row ceiling. Alternating-claim dry-run SQL is provided, NOT EXECUTED.
4. Task 4 limits: MET in local guard/refund/notice fixtures. Database admission is atomic by conditional UPSERT; real contention and quota boundaries are NOT VERIFIED.
5. Task 5 backstop: MET for formula fixtures and SQL/edge wiring. The dry run includes deadline, late-enqueue, expiry and cancellation checks, NOT EXECUTED.
6. Task 6 key refusal: MET in separate-lead 401/402/403 and 429 fixtures, engine result and one-warning SSR checks. Live overlap/UI: NOT VERIFIED.
7. Task 7 timing: MET for 25-second engine argument, bounded remaining-time fixtures and existing twenty-second ladder threshold. Live latency: NOT VERIFIED.
8. Task 8 JSON: MET for line/pretty/array/fence/prose/invalid layouts and preserved evidence checks; objects_found is numeric only. Real reply: NOT VERIFIED.
9. Task 9 owner names: MET for six positive patterns, former/foreign/non-person/exclusion cases and a team_page/no-enrollment engine save. Live precision/recall: NOT VERIFIED.
10. Task 10 defaults/reset: MET in pure defaults and UI-handler fixtures; the database UPDATE is written only. Actual production state is supplied evidence, NOT VERIFIED here.

## Redeploy list — proposed only

Apply/review migration 078 before deploying callers that require the new RPCs. It changes service-only runtime configuration, minute counters, notice/refusal run state, parallelism snapshots, maintenance/claim/check RPCs, the cron command and scrape defaults. Existing 075/076/077 files are not edited. No migration or deployment was performed.

A local recursive import-graph scan of changed shared modules and entrypoints found this conservative function union: check-replies, check-sequences, draft-linkedin-message, draft-reply, enrich-apollo, enrich-hunter, enrich-leads-bulk, find-decision-makers, generate-email, org-api-settings, parse-csv-leads, parse-icp, parse-notes, parse-session-notes, run-deep-find, run-lookup-jobs, run-selected-autopilot, run-verify-queue, scrape-companies-house, scrape-cro, scrape-google-places, send-email, suggest-sequence. Type-only import edges are included conservatively. Shared Gemini admission affects existing non-Deep-find AI callers too. Frontend rebuild is needed for the run warning and Reset to 400. No wrapper/container/VPS, secret, environment, Firecrawl or Places quota change is required.

## Not verified

No database was started or queried; migration syntax/execution, RLS, Vault/pg_cron/pg_net, overlapping claims, counter contention and dry-run assertions remain unverified. The local edge check is a TypeScript shim, not Deno execution. No search-engine, Gemini, LinkedIn, Microsoft, SMTP, registry or production request was made. No keys were read or created. No installation or spending. No push, merge, deploy, migration apply or VPS change. No task-owned server remains. Browser/mobile checks and independent Claude review are pending; UI evidence here is SSR/handler fixtures. One approved real run is needed after review/rollout to measure actual throughput, fairness, refusals and quality. Three cron invocations suggest up to three concurrent lead jobs, not proven threefold throughput.

## Deviations and open questions

The brief-execution hook was manually invoked; automatic lifecycle interception remains unverified. No hook/trust setup was altered. The all-Gemini transport audit found two separate HTTP paths during Task 6, so their Task 4 guard wiring is included in that commit. Run backstop snapshots parallelism at run creation to keep edge and SQL decisions consistent. The exact sizing formula stays at three hours under today's fifty-lead ceiling; the formula is still implemented exactly, including its eight-hour ceiling. No unrequested cap or verdict policy was changed. Once-per-run daily notices are keyed by resource, so distinct exhausted resources each get one useful notice. Existing accepted-main vault mirrors remain untouched; this branch receives its own checkpoint. Subscription usage is not exposed; checkpoints are saved proactively. Independent review is pending, not represented by builder self-checks.


## Final commits and seven-gate counts

| Task | Commit | App files | App passed | Wrapper files/passed | Other five gates |
| --- | --- | ---: | ---: | --- | --- |
| 1 audit/maintenance | d301d94 | 277 | 3,621 | 8 /166 | PASS |
| 2 cron parallelism | 300f9eb | 278 | 3,622 | 8 /166 | PASS |
| 3 fair claims | 746e8c1 | 279 | 3,623 | 8 /166 | PASS |
| 4 limits/notices | 29b55b0 | 280 | 3,629 | 8 /166 | PASS |
| 5 backstop | 7c071cf | 281 | 3,632 | 8 /166 | PASS |
| 6 key refusal | 605a197 | 284 | 3,640 | 8 /166 | PASS |
| 7 role budget | d32461b | 285 | 3,645 | 8 /166 | PASS |
| 8 JSON layouts | a5c82f4 | 286 | 3,656 | 8 /166 | PASS |
| 9 owner names | a6a3d6b | 287 | 3,671 | 8 /166 | PASS |
| 10 scrape defaults | This report-containing commit; resolve HEAD | 288 | 3,672 | 8 /166 | PASS |

Each app run retains one pre-existing opt-in skip. Other five gates are root TypeScript, production build, git diff --check (safecrlf disabled for checking only), the 29-entrypoint local edge TypeScript shim and wrapper TypeScript. Commands: npx tsc --noEmit; npx vitest run; npm run build; git -c core.safecrlf=false diff --check; node scripts/places-edge-typecheck.mjs; then npx tsc --noEmit and npx vitest run in worker/wrapper. Environment: VITE_SUPABASE_URL=http://127.0.0.1:54321 and VITE_SUPABASE_ANON_KEY=local-test-placeholder. Per-task ignored logs are .superpowers/parallel-taskN-*.log. Final Task 10 full gates passed before commit. All staging is by explicit path. Repository sync hooks are disabled for these local commits to preserve the accepted-main vault mirror; this does not disable the separately invoked brief-execution hook.

There are 53 more passing app tests than the fetched baseline (3,619), with the same 166 wrapper tests and existing skip. These fixtures demonstrate changed behavior locally, not production uplift. The final worktree is intended to be clean after the Task 10 commit. Shared status/handoff/index and a labelled checkpoint record the full resolved tip and hashes after commit; no accepted-main mirror is overwritten.
