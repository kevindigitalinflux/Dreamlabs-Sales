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
 a uuid; b uuid; lead uuid; picked uuid; i integer; signature text; client_role text;
BEGIN
 ASSERT NOT EXISTS(SELECT 1 FROM public.deep_find_runs WHERE status='active'), 'Empty disposable runs required';
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
