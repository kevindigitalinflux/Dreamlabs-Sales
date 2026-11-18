# API key health build report

## Result and scope

Local build on codex/key-health. Kevin approved the newer fetched origin/main 9a081f0c05397e204d6638818df6e160ec1a77cc in place of the brief's be3492b. Codex builds, Claude reviews/deploys only after separate authorization. Source brief: C:/Users/kevin/Projects/dreamlabs-sales-accuracy/docs/KEY-HEALTH-BUILD-BRIEF.md (read only). No provider call, key access, spending, installation, push, merge, deployment, production SQL or VPS action.

Three gated tasks: (1) health classification/recording and migration; (2) provider-call wiring/audit; (3) UI/desktop alerts and final handoff. Every task starts with red fixtures, all seven gates precede each explicit-path commit. Independent review and live 402 proof remain unverified. The local edge check is a TypeScript shim, not Deno runtime proof.

## Task 1 — rules, best-effort recorder and migration

Added pure fixed-provider wording/links and status classification, reusing Hunter's existing 429 distinction. Gemini RESOURCE_EXHAUSTED with exhausted daily quota is a top-up problem; per-minute throttling remains rate_limited. All twelve provider values are covered. Timeouts, network and 5xx do not create key problems. RPC arguments contain fixed codes only, never bodies, keys or URLs.

The recorder catches returned/thrown RPC errors and logs fixed diagnostics. Successful clears are memoised before awaiting, once per invocation/org/provider; the invocation object is explicit, not an isolate-wide cache. EdgeRuntime.waitUntil keeps best-effort writes alive where available. Features never wait for telemetry or change their result because telemetry failed.

Migration079 is written only. It adds the composite-key health table, constraints, RLS, member SELECT and realtime, plus service-only SECURITY DEFINER write RPCs. The brief's service-only grants refer to writes/RPCs: authenticated users receive SELECT through member RLS because the requested UI needs to read the table. No client writes are granted. Conditional UPSERT locks/rechecks the current tuple, throttles all writes within sixty seconds, preserves first_failed_at and prevents refused/needs_topup downgrading to rate_limited. Clear deletes the row; a later failure is a new problem.

Both new test modules were red before implementation. A fixture mock typing issue was corrected before the successful gates. All seven gates PASS: app302 files /3,751 passed /one existing skip; wrapper8 files /166 passed; root/wrapper TypeScript, production build, whitespace and edge29 PASS. Logs .superpowers/key-health-task1-*.log. No existing assertion changed. This report-containing first commit records Task1; exact commits will be listed at completion. Provider wiring/UI remain pending at this checkpoint.

## Rolled-back SQL dry run (written, NOT EXECUTED)

Use an empty disposable database migrated through078. The migration has no outer transaction, so it stays within this rollback. A failed DO assertion also requires ROLLBACK. Never run against production as part of this build.

```sql
BEGIN;
-- psql from repository root: \i supabase/migrations/079_api_key_health.sql
-- SQL Editor: paste the complete079 body above this DO block.
DO $$
DECLARE owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid(); a uuid; b uuid;
 first_at timestamptz; seen_count integer; client_role text; signature text;
BEGIN
 INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',id||'@health-fixture.test','',now(),'{}','{}',now(),now() FROM unnest(ARRAY[owner_id,outsider_id]) id;
 INSERT INTO public.organizations(name,created_by) VALUES('Health audit A',owner_id) RETURNING id INTO a;
 INSERT INTO public.organizations(name,created_by) VALUES('Health audit B',outsider_id) RETURNING id INTO b;
 INSERT INTO public.org_members(org_id,user_id,role) VALUES(a,owner_id,'admin'),(b,outsider_id,'admin');
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.api_key_failure(a,'gemini','needs_topup',402,'org','deep_find');
 SELECT first_failed_at INTO first_at FROM public.org_api_key_health WHERE org_id=a AND provider='gemini';
 PERFORM public.api_key_failure(a,'gemini','refused',401,'org','drafting');
 ASSERT EXISTS(SELECT 1 FROM public.org_api_key_health WHERE org_id=a AND provider='gemini' AND state='needs_topup' AND failure_count=1 AND first_failed_at=first_at), 'Minute throttle failed';
 UPDATE public.org_api_key_health SET last_failed_at=now()-interval '61 seconds' WHERE org_id=a AND provider='gemini';
 PERFORM public.api_key_failure(a,'gemini','rate_limited',429,'global','role_search');
 ASSERT EXISTS(SELECT 1 FROM public.org_api_key_health WHERE org_id=a AND provider='gemini' AND state='needs_topup' AND status_code=402 AND key_source='org' AND failure_count=2 AND first_failed_at=first_at), 'Topup downgraded';
 UPDATE public.org_api_key_health SET state='refused',status_code=401,last_failed_at=now()-interval '61 seconds' WHERE org_id=a AND provider='gemini';
 PERFORM public.api_key_failure(a,'gemini','rate_limited',429,'org','drafting');
 ASSERT EXISTS(SELECT 1 FROM public.org_api_key_health WHERE org_id=a AND state='refused' AND status_code=401 AND first_failed_at=first_at), 'Refusal downgraded';
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.org_api_key_health'::regclass);
 ASSERT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='org_api_key_health');
 FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
  ASSERT NOT has_table_privilege(client_role,'public.org_api_key_health','INSERT');
  ASSERT NOT has_table_privilege(client_role,'public.org_api_key_health','UPDATE');
  ASSERT NOT has_table_privilege(client_role,'public.org_api_key_health','DELETE');
  FOREACH signature IN ARRAY ARRAY['public.api_key_failure(uuid,text,text,integer,text,text)','public.api_key_ok(uuid,text)'] LOOP
   ASSERT NOT has_function_privilege(client_role,signature,'EXECUTE');
   ASSERT has_function_privilege('service_role',signature,'EXECUTE');
  END LOOP;
 END LOOP;
 ASSERT NOT has_table_privilege('anon','public.org_api_key_health','SELECT');
 ASSERT has_table_privilege('authenticated','public.org_api_key_health','SELECT');
 PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',owner_id)::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO seen_count FROM public.org_api_key_health WHERE org_id=a; ASSERT seen_count=1;
 SELECT count(*) INTO seen_count FROM public.org_api_key_health WHERE org_id=b; ASSERT seen_count=0;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('role','authenticated','sub',outsider_id)::text,true);
 SET LOCAL ROLE authenticated;
 SELECT count(*) INTO seen_count FROM public.org_api_key_health WHERE org_id=a; ASSERT seen_count=0;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 PERFORM public.api_key_ok(a,'gemini'); ASSERT NOT EXISTS(SELECT 1 FROM public.org_api_key_health WHERE org_id=a);
 PERFORM public.api_key_failure(a,'gemini','refused',403,'global','key_test');
 DELETE FROM public.organizations WHERE id=a;
 ASSERT NOT EXISTS(SELECT 1 FROM public.org_api_key_health WHERE org_id=a), 'Cascade failed';
END $$;
ROLLBACK;
```

## Not verified

SQL parsing/execution, RLS/realtime delivery and concurrency, real provider response shapes/billing URLs, desktop/browser/mobile and the held live Gemini402 are not verified. Provider audit, wiring and UI are still in progress at Task1. Subscription usage is unavailable; task commits and checkpoint reports are saved proactively. No external call, provider credential or production access is needed to build fixtures.
