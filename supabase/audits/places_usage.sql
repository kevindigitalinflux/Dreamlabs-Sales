-- REVIEW ONLY. Do not run without Kevin's authorization. All work is one DO block.
-- Expected final error: PLACES_AUDIT with PASS/FAIL lines. The exception rolls back EVERY fixture and counter change.
DO $$
DECLARE
  report TEXT := ''; a UUID; b UUID; admin_a UUID := gen_random_uuid(); member_a UUID := gen_random_uuid();
  m DATE := date_trunc('month', now() AT TIME ZONE 'America/Los_Angeles')::date;
  r JSONB; n INT; own_id UUID; shared_id UUID; before_shared INT; stamped UUID;
BEGIN
  INSERT INTO public.organizations(name) VALUES ('places-audit-a') RETURNING id INTO a;
  INSERT INTO public.organizations(name) VALUES ('places-audit-b') RETURNING id INTO b;
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (admin_a, 'places-admin@example.invalid'), (member_a, 'places-member@example.invalid')) u(id, email);
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (a, admin_a, 'admin'), (a, member_a, 'contractor');
  SELECT COALESCE((SELECT used FROM public.places_shared_counters WHERE month = m), 0) INTO before_shared;
  r := public.places_reserve(a, 3, false); own_id := (r->>'reservation_id')::uuid;
  report := report || chr(10) || CASE WHEN (r->>'ok')::boolean AND (r->>'used')::int = 3 AND (r->>'limit')::int = 900 THEN 'PASS' ELSE 'FAIL' END || ' default 900, reserve 3';
  SELECT COALESCE((SELECT used FROM public.places_shared_counters WHERE month = m), 0) INTO n;
  report := report || chr(10) || CASE WHEN n = before_shared THEN 'PASS' ELSE 'FAIL' END || ' own key leaves shared pool unchanged';
  report := report || chr(10) || CASE WHEN public.places_refund(a, 2, m, own_id) AND NOT public.places_refund(a, 2, m, own_id) THEN 'PASS' ELSE 'FAIL' END || ' refund is one-shot';
  report := report || chr(10) || CASE WHEN NOT public.places_refund(b, 1, m, own_id) AND NOT public.places_refund(a, 1, (m - interval '1 month')::date, own_id) THEN 'PASS' ELSE 'FAIL' END || ' refund rejects wrong org and month';
  INSERT INTO public.places_usage_limits (org_id, monthly_limit) VALUES (a, 1);
  r := public.places_reserve(a, 1, false);
  report := report || chr(10) || CASE WHEN r->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END || ' org cap refuses overshoot';
  UPDATE public.places_usage_limits SET monthly_limit = 0 WHERE org_id = a;
  r := public.places_reserve(a, 1, false);
  report := report || chr(10) || CASE WHEN r->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END || ' zero disables searches';
  UPDATE public.places_usage_limits SET monthly_limit = 900 WHERE org_id = a;
  -- This temporary change is rolled back by the mandatory final exception.
  UPDATE public.places_shared_limit SET monthly_limit = before_shared + 3 WHERE singleton;
  r := public.places_reserve(a, 3, true); shared_id := (r->>'reservation_id')::uuid;
  r := public.places_reserve(b, 1, true);
  report := report || chr(10) || CASE WHEN shared_id IS NOT NULL AND r->>'reason' = 'shared_pool' THEN 'PASS' ELSE 'FAIL' END || ' fallback orgs share one cap';
  report := report || chr(10) || CASE WHEN public.places_refund(a, 2, m, shared_id) THEN 'PASS' ELSE 'FAIL' END || ' shared refund succeeds';
  SELECT used INTO n FROM public.places_shared_counters WHERE month = m;
  report := report || chr(10) || CASE WHEN n = before_shared + 1 THEN 'PASS' ELSE 'FAIL' END || ' shared refund decrements only reserved units';
  report := report || chr(10) || CASE WHEN NOT has_function_privilege('anon', 'public.places_reserve(uuid,integer,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.places_reserve(uuid,integer,boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.places_refund(uuid,integer,date,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.places_refund(uuid,integer,date,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.places_snapshot(uuid)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END || ' anon/member cannot mutate usage; anon cannot snapshot';
  report := report || chr(10) || CASE WHEN has_function_privilege('service_role', 'public.places_reserve(uuid,integer,boolean)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.places_refund(uuid,integer,date,uuid)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END || ' service grants';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.places_usage_counters WHERE org_id = b;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' member cannot read another org counter';
  r := public.places_snapshot(a);
  report := report || chr(10) || CASE WHEN r->>'month' = m::text AND (r->>'used')::int = 2 THEN 'PASS' ELSE 'FAIL' END || ' own snapshot';
  BEGIN PERFORM public.places_snapshot(b); report := report || chr(10) || 'FAIL cross-org snapshot';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS cross-org snapshot refused'; END;
  BEGIN UPDATE public.places_usage_limits SET monthly_limit = 999 WHERE org_id = a; GET DIAGNOSTICS n = ROW_COUNT;
    report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' non-admin cannot edit limit';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS non-admin limit refused'; END;
  BEGIN INSERT INTO public.places_usage_limits(org_id, monthly_limit) VALUES (b, 900); report := report || chr(10) || 'FAIL member insert';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS member insert refused'; END;
  BEGIN UPDATE public.places_usage_counters SET used = 0; report := report || chr(10) || 'FAIL client counter write';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS client counter write refused'; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.places_usage_limits SET monthly_limit = 100000 WHERE org_id = a; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' admin edits own limit';
  UPDATE public.places_usage_limits SET monthly_limit = 100000 WHERE org_id = b; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' admin cannot edit another org';
  BEGIN UPDATE public.places_usage_limits SET monthly_limit = 100001 WHERE org_id = a; report := report || chr(10) || 'FAIL upper bound';
  EXCEPTION WHEN check_violation THEN report := report || chr(10) || 'PASS upper bound'; END;
  BEGIN UPDATE public.places_usage_limits SET monthly_limit = -1 WHERE org_id = a; report := report || chr(10) || 'FAIL lower bound';
  EXCEPTION WHEN check_violation THEN report := report || chr(10) || 'PASS lower bound'; END;
  BEGIN UPDATE public.places_usage_limits SET org_id = b WHERE org_id = a; report := report || chr(10) || 'FAIL key-column grant';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS key-column grant'; END;
  EXECUTE 'RESET ROLE';
  SELECT updated_by INTO stamped FROM public.places_usage_limits WHERE org_id = a;
  report := report || chr(10) || CASE WHEN stamped = admin_a THEN 'PASS' ELSE 'FAIL' END || ' server stamps editor';
  -- Mandatory rollback. Never remove, catch or replace this final exception with a NOTICE.
  RAISE EXCEPTION 'PLACES_AUDIT %', report;
END;
$$;
