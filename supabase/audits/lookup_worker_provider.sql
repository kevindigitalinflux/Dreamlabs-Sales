-- Run only after architect review and Kevin's authorization. Never reads Vault values.
-- Deliberate final exception rolls back every fixture write, like lookup_jobs_rls.sql.
DO $$
DECLARE
  fixture_org uuid;
  report text := '';
  provider_name text;
  enabled boolean;
BEGIN
  INSERT INTO public.organizations(name) VALUES ('Rollback worker provider audit') RETURNING id INTO fixture_org;
  FOREACH provider_name IN ARRAY ARRAY['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker'] LOOP
    INSERT INTO public.org_api_settings(org_id, provider, is_configured) VALUES (fixture_org, provider_name, false);
    report := report || chr(10) || 'PASS accepts ' || provider_name;
  END LOOP;
  BEGIN
    INSERT INTO public.org_api_settings(org_id, provider) VALUES (fixture_org, 'not_a_provider');
    report := report || chr(10) || 'FAIL unknown provider accepted';
  EXCEPTION WHEN check_violation THEN report := report || chr(10) || 'PASS rejects unknown provider'; END;
  SELECT relrowsecurity INTO enabled FROM pg_class WHERE oid = 'public.org_api_settings'::regclass;
  report := report || chr(10) || CASE WHEN enabled THEN 'PASS' ELSE 'FAIL' END || ' settings RLS enabled';
  report := report || chr(10) || CASE WHEN NOT has_function_privilege('authenticated', 'public.app_get_org_api_key(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.app_get_org_api_key(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.app_set_org_api_key(uuid,text,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.app_set_org_api_key(uuid,text,text)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END || ' Vault RPCs unavailable to browser roles';
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    SELECT EXISTS(SELECT 1 FROM public.org_api_settings WHERE org_id = fixture_org) INTO enabled;
    report := report || chr(10) || CASE WHEN NOT enabled THEN 'PASS' ELSE 'FAIL' END || ' anon cannot read fixture settings';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS anon read denied'; END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION E'LOOKUP_WORKER_PROVIDER_AUDIT (all writes rolled back)\n%', report;
END;
$$;
