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
 CHECK(source IN ('hunter','apollo','companies_house','cro','manual','dream_agent','role_search'));
-- 050 client INSERT allows only manual/dream_agent; its generic guard covers every source.
-- 053 already defaults include_in_sequences to false for every new contact.
COMMIT;
