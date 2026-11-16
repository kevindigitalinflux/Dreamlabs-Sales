-- Local draft. Accumulated across Stage 2 Tasks 2, 4, 5b and 5c; review before applying.
BEGIN;
-- 059 places the resource list CHECK on usage_resources, not its FK consumers.
ALTER TABLE public.usage_resources DROP CONSTRAINT usage_resources_resource_check;
ALTER TABLE public.usage_resources ADD CONSTRAINT usage_resources_resource_check
 CHECK(resource IN ('worker_scrape','worker_verify','worker_fetch','worker_search'));
INSERT INTO public.usage_resources(resource,label,default_org_limit,global_limit)
 VALUES('worker_search','Web searches',400,1200);
-- Task 4: arrays are read by all members; existing admin-write RLS remains unchanged.
CREATE FUNCTION public.role_list_valid(p_roles text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT SET search_path=public AS $$
 SELECT coalesce(bool_and(role IS NOT NULL AND char_length(role) BETWEEN 2 AND 60),true) FROM unnest(p_roles) role;
$$;
ALTER TABLE public.ideal_customer_profiles
 ADD COLUMN target_roles text[] NOT NULL DEFAULT '{}',
 ADD COLUMN fallback_roles text[] NOT NULL DEFAULT '{}',
 ADD CONSTRAINT icp_target_roles_size CHECK(cardinality(target_roles)<=12 AND public.role_list_valid(target_roles)),
 ADD CONSTRAINT icp_fallback_roles_size CHECK(cardinality(fallback_roles)<=12 AND public.role_list_valid(fallback_roles));
ALTER TABLE public.decision_maker_candidates DROP CONSTRAINT decision_maker_candidates_source_check;
ALTER TABLE public.decision_maker_candidates ADD CONSTRAINT decision_maker_candidates_source_check
 CHECK(source IN ('hunter','apollo','companies_house','cro','manual','dream_agent','role_search','team_page'));
-- 050 client INSERT allows only manual/dream_agent; its generic guard covers every source.
-- 053 already defaults include_in_sequences to false for every new contact.
-- Task 5c: informational monthly grounded-search usage.
CREATE TABLE public.gemini_search_usage (
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 month date NOT NULL,
 shared_key boolean NOT NULL,
 searches integer NOT NULL DEFAULT 0 CHECK(searches>=0),
 PRIMARY KEY(org_id,month,shared_key)
);
ALTER TABLE public.gemini_search_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY gemini_search_usage_member_read ON public.gemini_search_usage FOR SELECT TO authenticated
 USING(public.is_org_member(org_id));
REVOKE ALL ON public.gemini_search_usage FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.gemini_search_usage TO authenticated;
GRANT ALL ON public.gemini_search_usage TO service_role;

CREATE FUNCTION public.gemini_search_count(p_org uuid,p_shared boolean,p_n integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_month date:=date_trunc('month',now() AT TIME ZONE 'Europe/London')::date;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Service only' USING ERRCODE='42501'; END IF;
 IF p_org IS NULL OR p_shared IS NULL OR p_n IS NULL OR p_n<1 OR p_n>20 THEN RAISE EXCEPTION 'Invalid search count' USING ERRCODE='22023'; END IF;
 INSERT INTO public.gemini_search_usage(org_id,month,shared_key,searches) VALUES(p_org,current_month,p_shared,p_n)
 ON CONFLICT(org_id,month,shared_key) DO UPDATE SET searches=gemini_search_usage.searches+EXCLUDED.searches;
END $$;
REVOKE ALL ON FUNCTION public.gemini_search_count(uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gemini_search_count(uuid,boolean,integer) TO service_role;

CREATE FUNCTION public.gemini_search_snapshot(p_org uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE current_month date:=date_trunc('month',now() AT TIME ZONE 'Europe/London')::date;
 org_total bigint; shared_total bigint; uses_shared boolean;
BEGIN
 IF public.is_org_member(p_org) IS NOT TRUE THEN RAISE EXCEPTION 'Not an organisation member' USING ERRCODE='42501'; END IF;
 SELECT coalesce(o.use_global_api_fallback,false) AND NOT EXISTS(
  SELECT 1 FROM public.org_api_settings settings WHERE settings.org_id=p_org AND settings.provider='gemini' AND settings.is_configured)
 INTO uses_shared FROM public.organizations o WHERE o.id=p_org;
 SELECT coalesce(sum(searches),0) INTO org_total FROM public.gemini_search_usage WHERE org_id=p_org AND month=current_month;
 IF uses_shared THEN SELECT coalesce(sum(searches),0) INTO shared_total FROM public.gemini_search_usage WHERE shared_key AND month=current_month; END IF;
 RETURN jsonb_build_object('org_searches',org_total,'shared_key',uses_shared,'shared_searches',shared_total);
END $$;
REVOKE ALL ON FUNCTION public.gemini_search_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.gemini_search_snapshot(uuid) TO authenticated,service_role;
COMMIT;
