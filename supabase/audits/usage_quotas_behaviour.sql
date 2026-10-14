-- Rolled-back behaviour test for migration 059. Expected outcome: an error "USAGE_AUDIT" followed by PASS/FAIL lines.
DO $$
DECLARE
  r TEXT[] := ARRAY[]::TEXT[];
  v_org UUID; v_org2 UUID; v_res JSONB; v_ok BOOLEAN; v_used INT; v_gused INT; v_day DATE := (now() AT TIME ZONE 'Europe/London')::date;
  v_snap JSONB; i INT; v_succ INT;
BEGIN
  INSERT INTO public.organizations (name) VALUES ('usage-audit-a') RETURNING id INTO v_org;
  INSERT INTO public.organizations (name) VALUES ('usage-audit-b') RETURNING id INTO v_org2;

  -- 1. default limit is honoured: 150 verify checks pass, the 151st is refused as org_limit
  v_succ := 0;
  FOR i IN 1..151 LOOP
    v_res := public.usage_reserve(v_org, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  r := r || (CASE WHEN v_succ = 150 AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 1 default org limit 150 then org_limit (successes=' || v_succ || ', last reason=' || COALESCE(v_res->>'reason','null') || ')';

  -- 2. a refused reserve leaves counters unchanged
  SELECT used INTO v_used FROM public.usage_counters WHERE org_id = v_org AND resource = 'worker_verify' AND day = v_day;
  r := r || (CASE WHEN v_used = 150 THEN 'PASS' ELSE 'FAIL' END) || ' 2 refused reserve leaves the org counter at 150 (is ' || v_used || ')';

  -- 3. worker-wide cap: org B has its own room, but the shared pool (300) is what binds after A used 150 and B asks for 151
  v_succ := 0;
  FOR i IN 1..160 LOOP
    v_res := public.usage_reserve(v_org2, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  r := r || (CASE WHEN v_succ = 150 AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 3 org B gets its own 150 (successes=' || v_succ || ')';

  -- 4. lower the shared cap to 160 inside this rolled-back test: only 10 more pass, reason shared_pool
  UPDATE public.usage_resources SET global_limit = 310 WHERE resource = 'worker_verify';
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org, 'worker_verify', 400);
  v_succ := 0;
  FOR i IN 1..20 LOOP
    v_res := public.usage_reserve(v_org, 'worker_verify', 1);
    IF (v_res->>'ok')::boolean THEN v_succ := v_succ + 1; END IF;
  END LOOP;
  SELECT used INTO v_gused FROM public.usage_global_counters WHERE resource = 'worker_verify' AND day = v_day;
  r := r || (CASE WHEN v_succ = 10 AND v_res->>'reason' = 'shared_pool' AND v_gused = 310 THEN 'PASS' ELSE 'FAIL' END) || ' 4 shared cap binds even when the org limit is higher (successes=' || v_succ || ', global=' || v_gused || ')';

  -- 5. limit 0 refuses with org_limit
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org2, 'worker_fetch', 0);
  v_res := public.usage_reserve(v_org2, 'worker_fetch', 1);
  r := r || (CASE WHEN NOT (v_res->>'ok')::boolean AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 5 limit 0 refuses';

  -- 6. multi-unit reserve (deep scrape = 3) counts 3 and refuses when 3 do not fit
  v_res := public.usage_reserve(v_org, 'worker_scrape', 3);
  r := r || (CASE WHEN (v_res->>'ok')::boolean AND (v_res->>'used')::int = 3 THEN 'PASS' ELSE 'FAIL' END) || ' 6 three units counted';
  INSERT INTO public.usage_limits (org_id, resource, daily_limit) VALUES (v_org, 'worker_scrape', 4);
  v_res := public.usage_reserve(v_org, 'worker_scrape', 3);
  r := r || (CASE WHEN NOT (v_res->>'ok')::boolean AND v_res->>'reason' = 'org_limit' THEN 'PASS' ELSE 'FAIL' END) || ' 7 3 units refused when only 1 is left';

  -- 7. bad input is refused without touching anything
  r := r || (CASE WHEN v_res IS NOT NULL
      AND (public.usage_reserve(v_org, 'worker_scrape', 0)->>'reason') = 'bad_input'
      AND (public.usage_reserve(v_org, 'worker_scrape', 11)->>'reason') = 'bad_input'
      AND (public.usage_reserve(v_org, 'nope', 1)->>'reason') = 'bad_input'
      AND (public.usage_reserve(gen_random_uuid(), 'worker_scrape', 1)->>'reason') = 'bad_input'
      AND (public.usage_reserve(NULL, 'worker_scrape', 1)->>'reason') = 'bad_input'
      THEN 'PASS' ELSE 'FAIL' END) || ' 8 bad input (0, 11, unknown resource, unknown org, null) refused';

  -- 8. refund: works for used units, then refuses more than used, wrong day, bad units
  v_ok := public.usage_refund(v_org, 'worker_scrape', 3, v_day);
  SELECT used INTO v_used FROM public.usage_counters WHERE org_id = v_org AND resource = 'worker_scrape' AND day = v_day;
  r := r || (CASE WHEN v_ok AND v_used = 0 THEN 'PASS' ELSE 'FAIL' END) || ' 9 refund of used units works (ok=' || v_ok || ', used=' || v_used || ')';
  r := r || (CASE WHEN NOT public.usage_refund(v_org, 'worker_scrape', 1, v_day) THEN 'PASS' ELSE 'FAIL' END) || ' 10 cannot refund more than used';
  r := r || (CASE WHEN NOT public.usage_refund(v_org, 'worker_verify', 1, v_day + 1)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 1, v_day - 2)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 0, v_day)
                   AND NOT public.usage_refund(v_org, 'worker_verify', 11, v_day) THEN 'PASS' ELSE 'FAIL' END) || ' 11 refund refuses future day, too-old day and bad units';

  -- 9. a refund frees room again (global counter goes down with it)
  SELECT used INTO v_gused FROM public.usage_global_counters WHERE resource = 'worker_verify' AND day = v_day;
  v_ok := public.usage_refund(v_org2, 'worker_verify', 2, v_day);
  v_res := public.usage_reserve(v_org2, 'worker_verify', 1);
  r := r || (CASE WHEN v_ok AND (v_res->>'ok')::boolean THEN 'PASS' ELSE 'FAIL' END) || ' 12 refund frees room (ok=' || v_ok || ')';

  -- 10. snapshot as the database owner has no auth.uid(), so it must refuse (membership check)
  BEGIN
    v_snap := public.usage_snapshot(v_org);
    r := r || 'FAIL 13 snapshot should refuse a caller who is not a member';
  EXCEPTION WHEN insufficient_privilege THEN
    r := r || 'PASS 13 snapshot refuses a non-member (42501)';
  END;

  RAISE EXCEPTION E'USAGE_AUDIT\n%', array_to_string(r, E'\n');
END $$;
