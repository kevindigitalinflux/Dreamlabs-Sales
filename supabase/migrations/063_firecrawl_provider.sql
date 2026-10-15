-- Apply only after architect review and Kevin's authorization, after migration 062.
BEGIN;
ALTER TABLE public.org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE public.org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro','lookup_worker','firecrawl']));
COMMIT;
