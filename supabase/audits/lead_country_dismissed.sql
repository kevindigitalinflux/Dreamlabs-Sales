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
ROLLBACK;
