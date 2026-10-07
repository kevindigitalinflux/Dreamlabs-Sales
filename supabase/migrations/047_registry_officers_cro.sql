-- 047: CRO key provider, registry decision-maker sources, and officer capture on lead creation.

ALTER TABLE org_api_settings DROP CONSTRAINT org_api_settings_provider_check;
ALTER TABLE org_api_settings ADD CONSTRAINT org_api_settings_provider_check
  CHECK (provider = ANY (ARRAY['gemini','google_places','google_places_pro','companies_house','apollo','hunter','anthropic','opencorporates','cro']));

ALTER TABLE decision_maker_candidates DROP CONSTRAINT decision_maker_candidates_source_check;
ALTER TABLE decision_maker_candidates ADD CONSTRAINT decision_maker_candidates_source_check
  CHECK (source IN ('hunter','apollo','companies_house','cro'));

-- Registry scrapes store each company's people in raw_leads.raw_data.officers. Candidates are
-- service-role-write-only, and approval happens in the browser, so a SECURITY DEFINER trigger
-- copies them when the lead is created (covers manual approval and autopilot auto-approve).
-- Registry rows have no apollo_person_id and no email, so the generated dedupe_key
-- (source || ':' || coalesce(apollo_person_id, lower(email), id::text)) falls back to the row's
-- own fresh id: every insert is unique and no ON CONFLICT clause is needed.
CREATE OR REPLACE FUNCTION leads_copy_registry_officers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  raw_src text;
  raw_officers jsonb;
  o jsonb;
BEGIN
  IF NEW.raw_lead_id IS NULL THEN RETURN NEW; END IF;
  SELECT source, raw_data->'officers' INTO raw_src, raw_officers FROM raw_leads WHERE id = NEW.raw_lead_id;
  IF raw_src IS NULL OR raw_src NOT IN ('companies_house','cro')
     OR raw_officers IS NULL OR jsonb_typeof(raw_officers) <> 'array' THEN
    RETURN NEW;
  END IF;
  FOR o IN SELECT * FROM jsonb_array_elements(raw_officers) LOOP
    INSERT INTO decision_maker_candidates (lead_id, source, first_name, last_name, title, created_by)
    VALUES (NEW.id, raw_src, o->>'first_name', o->>'last_name', o->>'title', NEW.created_by);
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_copy_registry_officers ON leads;
CREATE TRIGGER leads_copy_registry_officers AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_copy_registry_officers();
