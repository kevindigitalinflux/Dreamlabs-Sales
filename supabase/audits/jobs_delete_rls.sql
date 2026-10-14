-- Rolled-back security audit for migration 060. Expected outcome: an error "JOBS_AUDIT" followed by PASS/FAIL lines.
-- It borrows one existing lead and its organisation (everything is rolled back), adds throwaway users, and creates a
-- second throwaway organisation to prove other organisations cannot delete.
DO $$
DECLARE
  r TEXT := '';
  v_org UUID; v_lead UUID; v_other UUID;
  v_admin UUID := gen_random_uuid(); v_creator UUID := gen_random_uuid(); v_member UUID := gen_random_uuid(); v_outsider UUID := gen_random_uuid();
  v_run_done UUID; v_run_done2 UUID; v_run_active UUID; v_run_admin UUID; v_run_other UUID;
  n INT;
BEGIN
  SELECT id, org_id INTO v_lead, v_org FROM public.leads LIMIT 1;
  IF v_lead IS NULL THEN RAISE EXCEPTION 'JOBS_AUDIT needs at least one lead in the database to borrow'; END IF;
  INSERT INTO public.organizations (name) VALUES ('jobs-audit-other') RETURNING id INTO v_other;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change,
    phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(), '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (v_admin, 'jobs-admin@example.invalid'), (v_creator, 'jobs-creator@example.invalid'), (v_member, 'jobs-member@example.invalid'), (v_outsider, 'jobs-outsider@example.invalid')) AS u(id, email);
  INSERT INTO public.org_members (org_id, user_id, role) VALUES
    (v_org, v_admin, 'admin'), (v_org, v_creator, 'contractor'), (v_org, v_member, 'contractor'), (v_other, v_outsider, 'admin');

  -- Runs in the borrowed organisation: two finished by the creator, one active by the creator, one finished by the admin.
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'completed', 1, now()) RETURNING id INTO v_run_done;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'cancelled', 1, now()) RETURNING id INTO v_run_done2;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count) VALUES (v_org, v_creator, 'active', 1) RETURNING id INTO v_run_active;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_admin, 'completed', 1, now()) RETURNING id INTO v_run_admin;
  INSERT INTO public.deep_find_runs (org_id, created_by, status, lead_count, finished_at) VALUES (v_org, v_creator, 'completed', 1, now()) RETURNING id INTO v_run_other;
  INSERT INTO public.deep_find_leads (run_id, org_id, lead_id, status) VALUES (v_run_done, v_org, v_lead, 'done');

  -- ===== a plain member who did not create the runs =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done2; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 1 a member cannot delete someone else''s finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 1 a member cannot delete someone else''s finished run (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== the creator =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_creator, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_active; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 2 nobody can delete a running run, even the creator (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 2 unexpected error (' || SQLERRM || ')'; END;
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 3 the creator can delete their own finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 3 creator delete failed (' || SQLERRM || ')'; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.deep_find_leads WHERE run_id = v_run_done;
  r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 4 the run''s lead rows went with it (left=' || n || ')';
  SELECT count(*) INTO n FROM public.leads WHERE id = v_lead;
  r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 5 the pipeline lead itself is untouched (rows=' || n || ')';

  -- ===== the organisation admin =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_done2; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END) || ' 6 an organisation admin can delete a member''s finished run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 6 admin delete failed (' || SQLERRM || ')'; END;
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_active; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 7 an admin cannot delete a running run either (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'FAIL 7 unexpected error (' || SQLERRM || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== another organisation's admin =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_other; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 8 another organisation''s admin cannot delete (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 8 another organisation''s admin cannot delete (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== anon =====
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN DELETE FROM public.deep_find_runs WHERE id = v_run_other; r := r || chr(10) || 'FAIL 9 anon could delete';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 9 anon cannot delete (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  -- ===== existing behaviour unchanged: a plain member still cannot delete an admin's finished run, and can still read =====
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.deep_find_runs WHERE org_id = v_org;
  r := r || chr(10) || (CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END) || ' 10 members can still read their organisation''s runs (rows=' || n || ')';
  BEGIN UPDATE public.deep_find_runs SET status = 'completed' WHERE id = v_run_admin; GET DIAGNOSTICS n = ROW_COUNT;
    r := r || chr(10) || (CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 11 update rights unchanged: a plain member cannot change another''s run (rows=' || n || ')';
  EXCEPTION WHEN OTHERS THEN r := r || chr(10) || 'PASS 11 update rights unchanged (' || SQLSTATE || ')'; END;
  EXECUTE 'RESET ROLE';

  RAISE EXCEPTION 'JOBS_AUDIT%', r;
END $$;
