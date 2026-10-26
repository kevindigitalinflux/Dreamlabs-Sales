-- REVIEW ONLY. Not executed by the builder. Requires reviewed/applied migration 065.
-- PRODUCTION: run ONLY this first block with Kevin's authorization. It creates no fixtures or auth users.
-- The deliberate final exception is the success report and rolls back this whole block.
DO $$
DECLARE field text;
BEGIN
  ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.leads'::regclass), 'lead RLS stays enabled';
  ASSERT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads'
    AND column_name = 'readiness' AND data_type = 'text' AND is_nullable = 'YES'), 'nullable readiness text';
  ASSERT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads'
    AND column_name = 'readiness_missing' AND udt_name = '_text' AND is_nullable = 'YES'), 'nullable missing-facts array';
  ASSERT EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.leads'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%readiness%ready%almost%needs_work%'), 'readiness allowlist';
  FOREACH field IN ARRAY ARRAY['readiness','readiness_missing'] LOOP
    ASSERT has_column_privilege('authenticated','public.leads',field,'UPDATE') =
      has_table_privilege('authenticated','public.leads','UPDATE'), 'new columns inherit existing table grant only';
    ASSERT has_column_privilege('anon','public.leads',field,'UPDATE') =
      has_table_privilege('anon','public.leads','UPDATE'), 'anon grants unchanged';
    ASSERT has_column_privilege('service_role','public.leads',field,'UPDATE'), 'engine can update readiness';
  END LOOP;
  RAISE EXCEPTION 'PASS 065 read-only assertions. No fixtures created. ROLLED BACK.';
END $$;

-- LOCAL / DISPOSABLE DATABASE ONLY. Do not run this second block on production.
-- This fixture block is separate so production never receives a throwaway auth user.
DO $$
DECLARE editor uuid := gen_random_uuid(); target_org uuid; pipeline uuid; target uuid;
BEGIN
  INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,
    email_change_token_new,email_change_token_current,email_change,phone_change,phone_change_token,reauthentication_token)
  VALUES('00000000-0000-0000-0000-000000000000',editor,'authenticated','authenticated',editor::text || '@example.invalid','',now(),
    '{}','{}',now(),now(),'','','','','','','','');
  INSERT INTO public.organizations(name) VALUES('065 local readiness audit') RETURNING id INTO target_org;
  INSERT INTO public.org_members(org_id,user_id,role) VALUES(target_org,editor,'contractor');
  INSERT INTO public.pipelines(org_id,name,is_default,created_by) VALUES(target_org,'065 private fixture',false,editor) RETURNING id INTO pipeline;
  INSERT INTO public.leads(org_id,pipeline_id,business_name,created_by)
    VALUES(target_org,pipeline,'065 rollback fixture',editor) RETURNING id INTO target;
  ASSERT (SELECT readiness IS NULL AND readiness_missing IS NULL FROM public.leads WHERE id = target), 'new leads not checked';
  UPDATE public.leads SET readiness = 'ready', readiness_missing = '{}' WHERE id = target;
  UPDATE public.leads SET readiness = 'almost', readiness_missing = ARRAY['verified_email'] WHERE id = target;
  UPDATE public.leads SET readiness = 'needs_work', readiness_missing = ARRAY['decision_maker','confirmed_website'] WHERE id = target;
  BEGIN
    UPDATE public.leads SET readiness = 'invalid' WHERE id = target;
    RAISE EXCEPTION 'invalid readiness was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  UPDATE public.leads SET readiness = NULL, readiness_missing = NULL WHERE id = target;
  ASSERT (SELECT readiness IS NULL FROM public.leads WHERE id = target), 'null remains allowed';
  RAISE EXCEPTION 'PASS 065 local readiness fixtures and constraints. ROLLED BACK.';
END $$;
