-- Kevin runs after applying 064, following architect review. All writes roll back.
-- No provider calls. No customer values printed. Raises on any failed assertion.
BEGIN;
DO $$
DECLARE
  target uuid;
  value text;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leads'::regclass), 'leads RLS must remain enabled';
  ASSERT has_column_privilege('authenticated', 'public.leads', 'country', 'UPDATE'), 'country UPDATE grant';
  ASSERT has_column_privilege('authenticated', 'public.leads', 'dismissed_suggestions', 'UPDATE'), 'dismissals UPDATE grant';
  ASSERT has_column_privilege('authenticated', 'public.leads', 'registry_candidates_rejected', 'UPDATE'), 'rejection UPDATE grant';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'leads' AND policyname = 'leads_update' AND cmd = 'UPDATE'), 'existing lead edit policy';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'decision_maker_candidates' AND policyname = 'decision_maker_candidates_insert' AND with_check LIKE '%can_edit_lead%' AND with_check LIKE '%auth.uid()%'), 'session contact INSERT remains gated';
  ASSERT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'decision_maker_candidates' AND policyname = 'decision_maker_candidates_update' AND qual LIKE '%can_edit_lead%'), 'session contact UPDATE remains gated';
  ASSERT NOT EXISTS (SELECT FROM public.leads WHERE country IS NOT NULL OR dismissed_suggestions <> '{}' OR registry_candidates_rejected), 'run immediately after migration: old leads keep defaults';
  SELECT id INTO target FROM public.leads LIMIT 1;
  ASSERT target IS NOT NULL, 'audit requires one existing lead';
  FOREACH value IN ARRAY ARRAY['GB','IE','US','OTHER',NULL] LOOP
    UPDATE public.leads SET country = value WHERE id = target;
    ASSERT (SELECT country IS NOT DISTINCT FROM value FROM public.leads WHERE id = target), 'country round trip';
  END LOOP;
  BEGIN
    UPDATE public.leads SET country = 'INVALID' WHERE id = target;
    RAISE EXCEPTION 'invalid country accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.leads SET dismissed_suggestions = NULL WHERE id = target;
    RAISE EXCEPTION 'NULL dismissals accepted';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  UPDATE public.leads SET dismissed_suggestions = ARRAY['email:review@example.com','person:jane smith'], registry_candidates_rejected = true WHERE id = target;
  ASSERT (SELECT dismissed_suggestions = ARRAY['email:review@example.com','person:jane smith'] AND registry_candidates_rejected FROM public.leads WHERE id = target), 'review state round trip';
  RAISE NOTICE 'PASS: defaults, countries, constraints, review state, grants and policy checks. All writes roll back.';
END $$;
-- Exercise the unchanged policies with an editor, a view-only share and an outsider.
DO $$
DECLARE
  target uuid; target_org uuid; private_pipeline uuid; contact uuid; n integer;
  editor uuid := gen_random_uuid(); viewer uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
BEGIN
  SELECT id, org_id INTO target, target_org FROM public.leads LIMIT 1;
  INSERT INTO auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change_token_current, email_change, phone_change, phone_change_token, reauthentication_token)
  SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.id::text || '@example.invalid', '', now(),
    '{}', '{}', now(), now(), '', '', '', '', '', '', '', ''
  FROM (VALUES (editor), (viewer), (outsider)) u(id);
  INSERT INTO public.org_members(org_id, user_id, role) VALUES (target_org, editor, 'contractor'), (target_org, viewer, 'contractor');
  INSERT INTO public.pipelines(org_id, name, is_default, created_by)
    VALUES (target_org, '064 rollback audit', false, editor) RETURNING id INTO private_pipeline;
  INSERT INTO public.pipeline_shares(pipeline_id, shared_with_user_id, permission, shared_by)
    VALUES (private_pipeline, viewer, 'view', editor);
  UPDATE public.leads SET pipeline_id = private_pipeline WHERE id = target;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', editor, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.leads SET country = 'IE', dismissed_suggestions = ARRAY['person:audit reviewer'], registry_candidates_rejected = true WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'editor can save country and review state';
  INSERT INTO public.decision_maker_candidates(lead_id, source, kind, first_name, last_name, created_by, include_in_sequences)
    VALUES (target, 'manual', 'person', 'Audit', 'Reviewer', editor, false) RETURNING id INTO contact;
  UPDATE public.decision_maker_candidates SET email = editor::text || '@example.invalid', include_in_sequences = false WHERE id = contact AND email IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 1, 'editor can fill a contact blank';
  ASSERT (SELECT NOT include_in_sequences FROM public.decision_maker_candidates WHERE id = contact), 'found contact follow-ups remain off';
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', viewer, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 1 FROM public.leads WHERE id = target), 'viewer can read lead';
  UPDATE public.leads SET country = 'US', dismissed_suggestions = '{}', registry_candidates_rejected = false WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'view-only share cannot save review state';
  UPDATE public.decision_maker_candidates SET email = 'denied@example.invalid' WHERE id = contact;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'view-only share cannot update a contact';
  BEGIN
    INSERT INTO public.decision_maker_candidates(lead_id, source, first_name, created_by, include_in_sequences)
      VALUES (target, 'manual', 'Denied', viewer, false);
    RAISE EXCEPTION 'view-only contact INSERT accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  ASSERT (SELECT count(*) = 0 FROM public.leads WHERE id = target), 'outsider cannot read lead';
  UPDATE public.leads SET country = 'OTHER', dismissed_suggestions = '{}', registry_candidates_rejected = false WHERE id = target;
  GET DIAGNOSTICS n = ROW_COUNT;
  ASSERT n = 0, 'outsider cannot save review state';
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'PASS: editor writes, view-only and outsider refusals, contact inserts/blank fills and sequence opt-out. Fixtures roll back.';
END $$;
ROLLBACK;
