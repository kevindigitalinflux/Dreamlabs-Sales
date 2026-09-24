-- Widens org_api_settings.provider to accept 'google_places_pro' — the
-- optional, paid Places API (New) key. Configuration-only for now: no
-- scraper feature reads this key yet (Legacy Places API stays the default,
-- free-tier discovery source). Reserved for a future org that wants the
-- richer New API results once the cost is worth it.

ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates']));
