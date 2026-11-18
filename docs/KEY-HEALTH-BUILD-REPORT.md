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

## Task 2 — record provider outcomes at their source

Task1 commit79f5394. Provider telemetry now runs in a request-scoped AsyncLocalStorage context, using the Node-compatible builtin (no package install). Each edge handler has an independent success memo and credential bindings; the existing resolver's source event supplies org/global provenance without additional Vault reads. No native/global fetch is patched. Provider transport modules observe an untouched response and schedule fixed-field writes with EdgeRuntime.waitUntil. Credentials/origins are kept only in the invocation's memory, never persisted or logged. Health observation errors do not change transport results, retries, provider order, quotas or caps. A bounded4KB/1.5-second clone read interprets429 hints; the original response remains readable.

Parallel Deep find, lookup and selected-lead work and reply drafting have explicit organisation scopes. Worker clients additionally supply their already-authorized orgId to match a shared connection correctly across concurrent queue rows. Sequential multi-org cron loops resolve their key immediately before the provider call; the most recent binding is used there. Tests include concurrent organisations with the same shared key. Real Deno/Node interop remains unverified despite the local Node fixtures and edge shim passing.

Observations for one org/provider are ordered within the invocation: a delayed quota-body read cannot overwrite a later successful retry. Successful clears remain once per invocation/org/provider. Known API semantics are interpreted at the source: Apollo's key-test HTTP200/is_logged_in=false becomes refused, and legacy Places REQUEST_DENIED/OVER_QUERY_LIMIT is handled instead of blindly clearing health. Other legacy error statuses do not clear an existing problem. Original feature responses stay unchanged.

org-api-settings records failed validation through the same response boundary with feature key_test, explicitly schedules clear after successful validation/save and adds a test-only action without Vault/settings writes. Testing an existing key resolves the org/global source normally (including a shared worker); supplying a new key tests that candidate as org source. Existing org-admin/platform-owner authorization stays; worker and Firecrawl management still require org-admin membership. No live test occurred.

### Provider-call audit

Every network transport found by source search is covered below; IMAP's method named fetch is not HTTP. Named helper lists enumerate the actual call surface, including multiple endpoints behind a common HTTP boundary. These observations are local source review, not live request traces.

| Provider | Calls audited | Recording boundary and attribution |
| --- | --- | --- |
| Gemini | ai.ts geminiJson and geminiGroundedSearch via geminiFetch; parse-icp direct generateContent; org-api-settings validateKey generateContent | Module-local health fetch; resolver org/global event; Deep find role fallback narrows feature to role_search. Internal minute-guard busy never dispatches and therefore never flags a key. |
| Anthropic | ai.ts claudeCall used by notes/draft/classification/sequence/reply/LinkedIn helpers; org-api-settings validateKey messages | Same transport observer; source bound by resolver or candidate key test. |
| Hunter | knownPersonLookup callJson/hunterJson: hunterAccount, hunterFindEmail, hunterDomainList, hunterVerifyEmail, hunterCompanySearch, hunterFindByCompany; apolloHunterLookup lookupHunterEmail, lookupHunterOwnerEmail, findHunterDecisionMaker, findHunterDecisionMakers; enrich-hunter direct domain-search; org-api-settings account validation | Direct fetch observer and shared fetchWithTimeout; query/header credentials matched only at api.hunter.io. Existing Hunter429 classifier reused. |
| Apollo | knownPersonLookup apolloMatchPerson/apolloOrgSearch; apolloHunterLookup lookupApolloPhone; apolloPeopleSearch searchApolloDecisionMaker, searchApolloDecisionMakers, revealApolloPerson; enrich-apollo organisation enrichment; org-api-settings auth/health | Shared timeout/direct observer and resolver source; false is_logged_in key-test response is not a successful clear. |
| Google Places | placesClient newPage, legacyPage, legacyPlaceDetails; scrape-google-places fetchPlaceDetails; shared validatePlacesKey | Shared timeout/direct observer handles New and legacy response shapes, retaining API credential/source identity. No reservation or refund change. |
| Google Places Pro | org-api-settings validateKey Places New IDs-only request | Candidate key-test binding identifies the pro section separately. No normal scraper consumer exists yet, as already documented in orgApiKeys; no new paid route is added. |
| Companies House | companiesHouse fetchFirstOfficer, fetchActiveOfficers, searchCompanyByName, searchCompaniesByName, searchCompaniesByStem, fetchCompanyProfile, searchOfficers, fetchOfficerAppointments; registryProofPeople fetchActivePscNames; scrape-companies-house direct search; org-api-settings key validation | Shared timeout/direct observer; Basic credential mapped to the resolver event. Existing registry ordering unchanged. |
| CRO | cro searchCroCompanies HTTP request used by scrape-cro and key validation | Direct observer matches the existing normalized Basic email:key credential at CRO hosts. |
| OpenCorporates | openCorporates search and detail requests; org-api-settings search validation | Shared timeout/direct observer maps api_token to org/global source. |
| Firecrawl | firecrawlClient validateFirecrawlKey credit-usage and makeFirecrawlClient.readTeam scrape | Default request is the module-local observer; normal injected fixture requests remain local. Existing own-key-only policy and page cap unchanged. |
| Lookup worker | workerClient.call paths /search, /ms-exists, /verify-email, /scrape-site; workerConfig.validateWorkerConnection /health | Observer matches only the configured origin and secret, with an explicit org hint for parallel queue workers. Worker401 flags lookup_worker; 5xx/timeouts do not falsely flag a secret. |
| Email verifier | No active standalone provider HTTP call exists in this base; only the reserved resolver provider value exists | Health schema/classifier support it. Actual mailbox verification is /verify-email on the lookup worker and is observed there. No standalone verifier endpoint/key consumer is invented or re-enabled. This brief/code gap was reported before wiring. |
| Public websites | leadResearch.fetchPageHtml and websiteContact public reads | Left out: no org API key. |
| DNS | dnsLookup DNS-over-HTTPS | Left out: no org API key. |
| Internal Supabase | SDK Auth/database/secret RPCs and run-autopilot's child function HTTP call | Left out: not third-party org API keys; each provider-consuming child invocation has its own health scope. No extra secret lookup is made for telemetry. |
| Mail and VPS internals | reply IMAP fetch, SMTP sends, Reacher/Microsoft/SearXNG calls inside worker/wrapper | Left out: mailbox credentials and VPS-internal provider protocols are not app org API keys. App-to-worker outcomes are covered; wrapper/VPS code is unchanged. |

### Task 2 evidence and changed assertions

New transport/scope fixtures were red before implementation. They cover provider credential shapes, org/global resolver provenance, body readability, concurrent shared-key org isolation, memoised success and failed health RPCs. Two further red fixtures caught the Apollo false-auth case and quota/success ordering before those were corrected. Endpoint fixtures cover successful test/no Vault write, failed Gemini test and existing shared-key provenance.

Existing orgApiSettings quota assertion now permits the required api_key_failure RPC while still forbidding Vault/settings writes, and asserts its fixed org/provider/source/feature/code/state. The existing runDeepFindCreate source-handler harness gained the real keyHealthHandler adapter; all five authorization/Start fresh assertions remain unchanged. No cap, provider ordering or Deep find verdict assertion changed. A local edit helper found TypeScript7 has no public compiler AST API; the already-installed Babel parser was used for precise handler/function wrapping. No install occurred.

All seven final gates PASS: app304 files /3,771 passed /one existing skip; wrapper8 /166; both TypeScript checks, production build, whitespace and edge29 PASS. Logs .superpowers/key-health-task2-*.log. This commit contains Task2. UI and warning links follow in Task3.

### Exact redeploy surface (current source graph; proposed only)

Provider-consuming entrypoints with request scopes: check-replies, check-sequences, draft-linkedin-message, draft-reply, enrich-apollo, enrich-hunter, enrich-leads-bulk, find-decision-makers, generate-email, org-api-settings, parse-csv-leads, parse-icp, parse-notes, parse-session-notes, reveal-decision-maker, run-deep-find, run-lookup-jobs, run-selected-autopilot, run-verify-queue, scrape-companies-house, scrape-cro, scrape-google-places, send-email, suggest-sequence. Migration079 must be reviewed/applied before rollout, plus frontend after Task3. No wrapper/container/VPS, secret/env, schedule or quota change. A final transitive scan will check this list before the report closes.
