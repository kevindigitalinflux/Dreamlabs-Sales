-- Migration 061 audit. NEVER run automatically. Architect reviews; Kevin runs after applying.
-- All fixtures and writes are rolled back by the final LOOKUP_JOBS_AUDIT exception.
-- Borrow a lead into a private throwaway pipeline so visibility does not depend on existing data.
-- Run only after review, while jobs are idle. No fixture or borrowed-lead change is committed.
DO $$
DECLARE
  report text := '';
  org uuid; other_org uuid; lead uuid; private_pipeline uuid;
  creator uuid := gen_random_uuid(); member uuid := gen_random_uuid(); admin uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  done_job uuid; cancelled_job uuid; active_job uuid; other_job uuid; review_job uuid;
  result_row uuid; n int; ok boolean; claimed public.lookup_job_leads;
  before_review jsonb; after_review jsonb; invalid_choice text;
BEGIN
  SELECT id, org_id INTO lead, org FROM public.leads LIMIT 1;
  IF lead IS NULL THEN RAISE EXCEPTION 'LOOKUP_JOBS_AUDIT requires one lead to borrow'; END IF;
  INSERT INTO public.organizations(name) VALUES ('lookup-audit-other') RETURNING id INTO other_org;
  INSERT INTO auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, '', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
    FROM (VALUES (creator, 'lookup-creator@example.invalid'), (member, 'lookup-member@example.invalid'),
      (admin, 'lookup-admin@example.invalid'), (outsider, 'lookup-outsider@example.invalid')) u(id, email);
  INSERT INTO public.org_members(org_id, user_id, role) VALUES
    (org, creator, 'contractor'), (org, member, 'contractor'), (org, admin, 'admin'), (other_org, outsider, 'admin');
  INSERT INTO public.pipelines(org_id, name, is_default, created_by)
    VALUES (org, 'lookup-audit-private', false, creator) RETURNING id INTO private_pipeline;
  UPDATE public.leads SET pipeline_id = private_pipeline WHERE id = lead;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, status, lead_count, finished_at)
    VALUES (org, creator, 'enrich', 'completed', 1, now()) RETURNING id INTO done_job;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, status, lead_count, finished_at)
    VALUES (org, creator, 'enrich', 'cancelled', 1, now()) RETURNING id INTO cancelled_job;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, lead_count)
    VALUES (org, creator, 'enrich', 1) RETURNING id INTO active_job;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, status, lead_count, finished_at)
    VALUES (other_org, outsider, 'enrich', 'completed', 1, now()) RETURNING id INTO other_job;
  INSERT INTO public.lookup_jobs(org_id, created_by, kind, status, lead_count, finished_at)
    VALUES (org, creator, 'enrich', 'completed', 1, now()) RETURNING id INTO review_job;
  INSERT INTO public.lookup_job_leads(job_id, org_id, lead_id, status)
    VALUES (done_job, org, lead, 'done');
  INSERT INTO public.lookup_job_leads(job_id, org_id, lead_id, status, review, result)
    VALUES (review_job, org, lead, 'done', 'pending', '{"proposed":{"email":"audit@example.invalid"},"source":{"email":"website"},"steps":[]}')
    RETURNING id INTO result_row;
  SELECT to_jsonb(l) INTO before_review FROM public.lookup_job_leads l WHERE id = result_row;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.lookup_jobs WHERE id IN (done_job, other_job);
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' member reads own-org jobs only';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = result_row;
  report := report || chr(10) || CASE WHEN n = 0 AND NOT public.can_view_lead(lead) THEN 'PASS' ELSE 'FAIL' END || ' member without lead visibility sees no result';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE job_id = review_job AND review = 'pending';
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' hidden pending proposals do not count towards needs_you';
  ok := public.lookup_job_review(result_row, 'dismissed');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' hidden lead cannot be reviewed';
  DELETE FROM public.lookup_jobs WHERE id = done_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' member cannot delete another creator''s job';
  BEGIN
    INSERT INTO public.lookup_jobs(org_id, created_by, kind, lead_count) VALUES (org, member, 'enrich', 1);
    report := report || chr(10) || 'FAIL authenticated job INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS authenticated job INSERT refused'; END;
  BEGIN
    INSERT INTO public.lookup_job_leads(job_id, org_id, lead_id) VALUES (active_job, org, lead);
    report := report || chr(10) || 'FAIL authenticated result INSERT allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS authenticated result INSERT refused'; END;
  BEGIN
    UPDATE public.lookup_jobs SET status = 'completed' WHERE id = active_job;
    report := report || chr(10) || 'FAIL authenticated job UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS authenticated job UPDATE refused'; END;
  BEGIN
    UPDATE public.lookup_job_leads SET review = 'applied', result = '{}' WHERE id = result_row;
    report := report || chr(10) || 'FAIL direct result/review UPDATE allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS direct result/review UPDATE refused'; END;
  BEGIN
    DELETE FROM public.lookup_job_leads WHERE id = result_row;
    report := report || chr(10) || 'FAIL direct result DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS direct result DELETE refused'; END;
  BEGIN
    PERFORM public.lookup_job_claim(1);
    report := report || chr(10) || 'FAIL authenticated claim allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS authenticated claim refused'; END;
  report := report || chr(10) || CASE WHEN NOT has_function_privilege('authenticated', 'public.lookup_job_create(uuid,uuid,text,uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.lookup_job_cancel(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.lookup_job_finish(uuid,int,text,text,jsonb,text)', 'EXECUTE') THEN 'PASS' ELSE 'FAIL' END
    || ' all engine RPCs service-only';
  EXECUTE 'RESET ROLE';

  -- A view share exposes proposals, but never grants the right to review them.
  INSERT INTO public.pipeline_shares(pipeline_id, shared_with_user_id, permission, shared_by)
    VALUES (private_pipeline, member, 'view', creator);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', member, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = result_row AND review = 'pending';
  report := report || chr(10) || CASE WHEN n = 1 AND public.can_view_lead(lead) AND NOT public.can_edit_lead(lead)
    THEN 'PASS' ELSE 'FAIL' END || ' view-only member reads visible pending proposal';
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' view-only member cannot apply review';
  ok := public.lookup_job_review(result_row, 'dismissed');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' view-only member cannot dismiss review';
  EXECUTE 'RESET ROLE';

  -- Pipeline ownership still supplies edit rights after membership removal: test BOTH checks.
  DELETE FROM public.org_members WHERE org_id = org AND user_id = creator;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', creator, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN public.can_edit_lead(lead) AND NOT ok THEN 'PASS' ELSE 'FAIL' END || ' edit rights without organisation membership cannot review';
  EXECUTE 'RESET ROLE';
  INSERT INTO public.org_members(org_id, user_id, role) VALUES (org, creator, 'contractor');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', creator, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN public.can_edit_lead(lead) AND ok THEN 'PASS' ELSE 'FAIL' END || ' member with edit rights applies pending review';
  ok := public.lookup_job_review(result_row, 'dismissed');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' applied review cannot change to dismissed';
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' applied review cannot be applied again';
  DELETE FROM public.lookup_jobs WHERE id = active_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' creator cannot delete active job';
  DELETE FROM public.lookup_jobs WHERE id = done_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' creator can delete finished job';
  EXECUTE 'RESET ROLE';
  SELECT to_jsonb(l) INTO after_review FROM public.lookup_job_leads l WHERE id = result_row;
  report := report || chr(10) || CASE WHEN after_review->>'review' = 'applied'
    AND (before_review - 'review') = (after_review - 'review') THEN 'PASS' ELSE 'FAIL' END || ' apply changes only review column';
  UPDATE public.lookup_job_leads SET review = 'pending' WHERE id = result_row;
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE job_id = done_job;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' deleted job cascades only its result rows';
  SELECT count(*) INTO n FROM public.leads WHERE id = lead;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' pipeline lead survives job deletion';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = result_row;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' own-org admin reads results';
  DELETE FROM public.lookup_jobs WHERE id = cancelled_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' admin can delete ended member job';
  DELETE FROM public.lookup_jobs WHERE id = active_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' admin cannot delete active job';
  BEGIN
    ok := public.lookup_job_review(result_row, 'dismissed');
    report := report || chr(10) || CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END || ' admin with edit rights dismisses pending review';
  EXCEPTION WHEN OTHERS THEN report := report || chr(10) || 'FAIL own-org review raised ' || SQLSTATE; END;
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' dismissed review cannot change to applied';
  FOREACH invalid_choice IN ARRAY ARRAY['pending', 'none', 'invalid', NULL]::text[] LOOP
    BEGIN
      PERFORM public.lookup_job_review(result_row, invalid_choice);
      report := report || chr(10) || 'FAIL review accepts invalid choice ' || coalesce(invalid_choice, 'NULL');
    EXCEPTION WHEN raise_exception THEN report := report || chr(10) || 'PASS review rejects choice ' || coalesce(invalid_choice, 'NULL'); END;
  END LOOP;
  EXECUTE 'RESET ROLE';
  SELECT to_jsonb(l) INTO after_review FROM public.lookup_job_leads l WHERE id = result_row;
  report := report || chr(10) || CASE WHEN after_review->>'review' = 'dismissed'
    AND (before_review - 'review') = (after_review - 'review') THEN 'PASS' ELSE 'FAIL' END || ' dismiss changes only review column';
  UPDATE public.lookup_job_leads SET review = 'none' WHERE id = result_row;
  EXECUTE 'SET LOCAL ROLE authenticated';
  ok := public.lookup_job_review(result_row, 'applied');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' none cannot transition to applied';
  ok := public.lookup_job_review(result_row, 'dismissed');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' none cannot transition to dismissed';
  EXECUTE 'RESET ROLE';
  UPDATE public.lookup_job_leads SET review = 'pending' WHERE id = result_row;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = result_row;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' other org cannot read results';
  DELETE FROM public.lookup_jobs WHERE id = review_job; GET DIAGNOSTICS n = ROW_COUNT;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' other org cannot delete';
  BEGIN
    ok := public.lookup_job_review(result_row, 'dismissed');
    report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' other org cannot review';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS other org review refused';
    WHEN OTHERS THEN report := report || chr(10) || 'FAIL other-org review unexpected error ' || SQLSTATE; END;
  EXECUTE 'RESET ROLE';
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = result_row AND review = 'pending';
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' cross-org review left row untouched';

  -- Defence in depth: bypass only EXECUTE ACL by selecting the authenticated SQL role,
  -- but retain an anon JWT claim (even with an editor sub) or no signed-in user.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'anon')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.lookup_job_review(result_row, 'applied');
    report := report || chr(10) || 'FAIL review body accepts anon JWT';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS review body rejects anon JWT'; END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.lookup_job_review(result_row, 'applied');
    report := report || chr(10) || 'FAIL review body accepts missing user';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS review body rejects missing user'; END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    DELETE FROM public.lookup_jobs WHERE id = review_job;
    report := report || chr(10) || 'FAIL anon DELETE allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS anon DELETE refused'; END;
  BEGIN
    PERFORM public.lookup_job_review(result_row, 'applied');
    report := report || chr(10) || 'FAIL anon review allowed';
  EXCEPTION WHEN insufficient_privilege THEN report := report || chr(10) || 'PASS anon review refused'; END;
  report := report || chr(10) || CASE WHEN NOT has_table_privilege('anon', 'public.lookup_jobs', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.lookup_job_leads', 'SELECT') THEN 'PASS' ELSE 'FAIL' END || ' anon cannot read either table';
  report := report || chr(10) || CASE WHEN NOT has_table_privilege('anon', 'public.lookup_jobs', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    AND NOT has_table_privilege('anon', 'public.lookup_job_leads', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    THEN 'PASS' ELSE 'FAIL' END || ' anon has no table write privileges';
  report := report || chr(10) || CASE WHEN NOT has_function_privilege('anon', 'public.lookup_job_claim(int)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.lookup_job_create(uuid,uuid,text,uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.lookup_job_cancel(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.lookup_job_finish(uuid,int,text,text,jsonb,text)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END || ' anon cannot execute engine RPCs';
  report := report || chr(10) || CASE WHEN has_function_privilege('service_role', 'public.lookup_job_claim(int)', 'EXECUTE')
    THEN 'PASS' ELSE 'FAIL' END || ' service role can execute claim';
  EXECUTE 'RESET ROLE';

  -- max_leads=0 performs housekeeping only: it never claims a real queued lead.
  -- Housekeeping also touches stale real rows, but all changes are rolled back; run while jobs are idle.
  INSERT INTO public.lookup_job_leads(job_id, org_id, lead_id, status, attempts, claimed_at)
    VALUES (active_job, org, lead, 'running', 1, now() - interval '6 minutes');
  PERFORM public.lookup_job_claim(0);
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE job_id = active_job AND status = 'queued' AND attempts = 1;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' stale lease requeues once';
  UPDATE public.lookup_job_leads SET status = 'running', attempts = 2, claimed_at = now() - interval '6 minutes' WHERE job_id = active_job;
  PERFORM public.lookup_job_claim(0);
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE job_id = active_job AND status = 'failed' AND attempts = 2;
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' second interrupted attempt fails';
  SELECT count(*) INTO n FROM public.lookup_jobs WHERE id = active_job AND status = 'completed';
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' job completes after last terminal row';

  UPDATE public.lookup_jobs SET status = 'active', finished_at = NULL WHERE id = active_job;
  UPDATE public.lookup_job_leads SET status = 'running', claimed_at = now() WHERE job_id = active_job RETURNING * INTO claimed;
  ok := public.lookup_job_finish(claimed.id, 1, 'done', 'Old attempt', '{}', 'none');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' old attempt cannot overwrite current claim';
  PERFORM public.lookup_job_cancel(active_job);
  ok := public.lookup_job_finish(claimed.id, 2, 'done', 'Late result', '{}', 'none');
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE id = claimed.id AND status = 'skipped';
  report := report || chr(10) || CASE WHEN NOT ok AND n = 1 THEN 'PASS' ELSE 'FAIL' END || ' late result cannot revive cancelled work';

  -- Simulate deletion after claim. The FK removes results; the job snapshot survives.
  UPDATE public.lookup_jobs SET status = 'active', finished_at = NULL WHERE id = active_job;
  UPDATE public.lookup_job_leads SET status = 'running', claimed_at = now() WHERE id = claimed.id;
  DELETE FROM public.leads WHERE id = lead;
  SELECT count(*) INTO n FROM public.lookup_job_leads WHERE lead_id = lead;
  report := report || chr(10) || CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END || ' lead deletion cascades all its lookup rows without placeholders';
  SELECT count(*) INTO n FROM public.lookup_jobs WHERE id IN (active_job, review_job) AND lead_count = 1;
  report := report || chr(10) || CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' lead deletion preserves job headers and lead_count snapshots';
  ok := public.lookup_job_finish(claimed.id, claimed.attempts, 'skipped', 'This lead is no longer available.', '{}', 'none');
  report := report || chr(10) || CASE WHEN NOT ok THEN 'PASS' ELSE 'FAIL' END || ' finishing a cascaded claim is a harmless no-op';
  PERFORM public.lookup_job_claim(0);
  SELECT count(*) INTO n FROM public.lookup_jobs WHERE id = active_job AND status = 'completed';
  report := report || chr(10) || CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END || ' empty active job completes on next tick';

  SELECT count(*) INTO n FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public' AND tablename IN ('lookup_jobs', 'lookup_job_leads');
  report := report || chr(10) || CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END || ' both tables published for realtime';
  RAISE EXCEPTION E'LOOKUP_JOBS_AUDIT (all writes rolled back)\n%', report;
END;
$$;
