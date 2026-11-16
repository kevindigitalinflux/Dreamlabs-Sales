-- Local draft. Accumulated across Stage 2 Tasks 2, 4, 5b and 5c; review before applying.
BEGIN;
-- 059 places the resource list CHECK on usage_resources, not its FK consumers.
ALTER TABLE public.usage_resources DROP CONSTRAINT usage_resources_resource_check;
ALTER TABLE public.usage_resources ADD CONSTRAINT usage_resources_resource_check
 CHECK(resource IN ('worker_scrape','worker_verify','worker_fetch','worker_search'));
INSERT INTO public.usage_resources(resource,label,default_org_limit,global_limit)
 VALUES('worker_search','Web searches',400,1200);
COMMIT;
