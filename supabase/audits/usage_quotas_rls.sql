-- Rolled-back security audit for migration 059 (same method as the cycle 2/3 audits, but nothing persists).
-- Expected outcome: an error "USAGE_AUDIT" followed by PASS/FAIL lines.
DO $$
DECLARE
  r TEXT := '';
  v_a UUID; v_b UUID; v_admin_a UUID := gen_random_uuid(); v_member_a UUID := gen_random_uuid(); v_admin_b UUID := gen_random_uuid();
  n INT; v_snap JSONB; v_by UUID;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('usage-rls-a') RETURNING id INTO v_a;
  INSERT INTO public.organizations (name) VALUES ('usage-rls-b') RETURNING id INTO v_b;
  -- Three throwaway users (the handle_new_user trigger creates their profiles).
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (v_admin_a, 'usage-admin-a@example.invalid'), (v_member_a, 'usage-member-a@example.invalid'), (v_admin_b, 'usage-admin-b@example.invalid')) AS u(id, email);
  INSERT INTO public.org_members (org_id, user_id, role) VALUES (v_a, v_admin_a, 'admin'), (v_a, v_member_a, 'contractor'), (v_b, v_admin_b, 'admin');
  -- Some usage so there is something to read.
  PERFORM public.usage_reserve(v_a, 'worker_scrape', 2);
  PERFORM public.usage_reserve(v_b, 'worker_scrape', 5);

  -- ===== member of A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.usage_counters;
  r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 1 member sees only their own organisation''s counters (rows=' || n || ')';
  SELECT public.usage_snapshot(v_a) INTO v_snap;
  r := r || chr(10) || (CASE WHEN jsonb_array_length(v_snap) = 3 THEN 'PASS' ELSE 'FAIL' END) || ' 2 member can read their snapshot (3 resources)';
  BEGIN PERFORM public.usage_snapshot(v_b); r := r || chr(10) || 'FAIL 3 member read another organisation''s snapshot';
  EXCEPTION WHEN insufficient_privilege THEN r := r || chr(10) || 'PASS 3 snapshot of another organisation refused (42501)'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_scrape', 999); r := r || chr(10) || 'FAIL 4 non-admin inserted a limit';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 4 non-admin cannot insert a limit (' || SQLSTATE || ')'; END;
  BEGIN UPDATE public.usage_counters SET used = 0; GET DIAGNOSTICS n = ROW_COUNT; r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 5 member cannot update counters (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 5 member cannot update counters (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_counters (org_id, resource, day, used) VALUES (v_a, 'worker_fetch', current_date, 0); r := r || chr(10) || 'FAIL 6 member inserted a counter';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 6 member cannot insert counters (' || SQLSTATE || ')'; END;
  BEGIN PERFORM 1 FROM public.usage_global_counters; r := r || chr(10) || 'FAIL 7 member can read worker-wide counters';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 7 worker-wide counters unreadable (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_reserve(v_a, 'worker_scrape', 1); r := r || chr(10) || 'FAIL 8 member can call usage_reserve';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 8 usage_reserve not callable by members (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_refund(v_a, 'worker_scrape', 1, current_date); r := r || chr(10) || 'FAIL 9 member can call usage_refund';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 9 usage_refund not callable by members (' || SQLSTATE || ')'; END;
  BEGIN UPDATE public.usage_resources SET global_limit = 99999; GET DIAGNOSTICS n = ROW_COUNT; r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 10 member cannot change the shared caps (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 10 member cannot change the shared caps (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== admin of A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_scrape', 60); r := r || chr(10) || 'PASS 11 admin can set their own limit';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 11 admin could not set a limit (' || SQLERRM || ')'; END;
  -- The Settings card saves with UPDATE ... SET daily_limit (never an upsert, which would also SET org_id/resource).
  BEGIN UPDATE public.usage_limits SET daily_limit = 61 WHERE org_id = v_a AND resource = 'worker_scrape'; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 11b admin can update daily_limit on their own row (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 11b admin could not update daily_limit (' || SQLERRM || ')'; END;
  BEGIN UPDATE public.usage_limits SET org_id = v_b WHERE org_id = v_a AND resource = 'worker_scrape'; r := r || chr(10) || 'FAIL 11c admin could rewrite org_id';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 11c admin cannot rewrite the key columns (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';
  SELECT updated_by INTO v_by FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_scrape';
  r := r || chr(10) || (CASE WHEN v_by = v_admin_a THEN 'PASS' ELSE 'FAIL' END) || ' 12 updated_by is stamped by the trigger';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit, updated_by) VALUES (v_a, 'worker_verify', 70, v_admin_b); EXCEPTION WHEN OTHERS THEN NULL; END;
  EXECUTE 'RESET ROLE';
  SELECT updated_by INTO v_by FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_verify';
  r := r || chr(10) || (CASE WHEN v_by IS NULL OR v_by = v_admin_a THEN 'PASS' ELSE 'FAIL' END) || ' 13 a client cannot forge updated_by';
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_b, 'worker_scrape', 1); r := r || chr(10) || 'FAIL 14 admin of A set a limit for B';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 14 admin of A cannot set a limit for B (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_fetch', 5001); r := r || chr(10) || 'FAIL 15 limit above 5000 accepted';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 15 limit above 5000 refused (' || SQLSTATE || ')'; END;
  BEGIN INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_a, 'worker_fetch', -1); r := r || chr(10) || 'FAIL 16 negative limit accepted';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 16 negative limit refused (' || SQLSTATE || ')'; END;
  BEGIN DELETE FROM public.usage_limits WHERE org_id = v_a AND resource = 'worker_scrape'; GET DIAGNOSTICS n = ROW_COUNT; r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 17 admin can reset their own limit to default (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 17 admin delete failed (' || SQLERRM || ')'; END;
  BEGIN UPDATE public.usage_limits SET daily_limit = 1 WHERE org_id = v_b; GET DIAGNOSTICS n = ROW_COUNT; r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 18 admin of A cannot edit B''s limits (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 18 admin of A cannot edit B''s limits (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== outsider (admin of B) cannot see A =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.usage_counters WHERE org_id = v_a;
  r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 19 admin of B cannot see A''s counters (rows=' || n || ')';
  EXECUTE 'RESET ROLE';

  -- ===== anon =====
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM 1 FROM public.usage_counters; r := r || chr(10) || 'FAIL 20 anon can read counters';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 20 anon cannot read counters (' || SQLSTATE || ')'; END;
  BEGIN PERFORM public.usage_snapshot(v_a); r := r || chr(10) || 'FAIL 21 anon can call usage_snapshot';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 21 anon cannot call usage_snapshot (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'USAGE_AUDIT%', r;
END $$;
