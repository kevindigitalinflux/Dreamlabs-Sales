-- Draft only. Apply after architect review and Kevin's approval. Existing phones remain untouched.
ALTER TABLE public.decision_maker_candidates
  ADD COLUMN phone_kind text NOT NULL DEFAULT 'unknown' CHECK (phone_kind IN ('company_line','direct','mobile','unknown')),
  ADD COLUMN phone_source text NOT NULL DEFAULT 'manual' CHECK (phone_source IN ('places','own_site','worker_scrape','registry','apollo','manual','other')),
  ADD COLUMN phone_source_url text,
  ADD COLUMN phone_found_at timestamptz;
ALTER TABLE public.leads ADD COLUMN phone_meta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(phone_meta) = 'object');

-- Only these new editable metadata columns gain UPDATE. No existing grants, RLS policies or guard are replaced.
GRANT UPDATE (phone_kind, phone_source, phone_source_url, phone_found_at)
  ON public.decision_maker_candidates TO authenticated;

-- Conservative key conversion for legacy values and writers predating this feature. This is NOT an admission
-- or calling check: the shared TypeScript library performs parsing/validation before a number is offered or dialed.
-- Unconvertible originals remain in phone/additional_phones, never discarded or guessed as a different country.
CREATE FUNCTION public.phone_metadata_key(raw text, country text DEFAULT 'GB') RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE digits text := regexp_replace(raw, '[^0-9]', '', 'g');
BEGIN
  IF raw IS NULL OR raw !~ '^\+?[0-9 ().-]+$' OR raw ~ '[0-9]{4}-[0-9]{2}-[0-9]{2}'
    OR raw ~ '^[0-9]{4}-[0-9]{4}$' OR digits ~ '([0-9])\1{6}' THEN RETURN NULL; END IF;
  IF raw LIKE '+%' AND digits ~ '^[1-9][0-9]{7,14}$' THEN
    RETURN '+' || regexp_replace(digits, '^(44|353|971|966)0', '\1');
  ELSIF digits LIKE '00%' AND length(digits) BETWEEN 10 AND 17 THEN RETURN '+' || substr(digits, 3);
  ELSIF coalesce(country, 'GB') = 'GB' AND digits ~ '^0[12378][0-9]{9}$' THEN RETURN '+44' || substr(digits, 2);
  ELSIF country = 'IE' AND digits ~ '^0[1-9][0-9]{6,8}$' THEN RETURN '+353' || substr(digits, 2);
  ELSIF country = 'US' AND digits ~ '^[2-9][0-9]{9}$' THEN RETURN '+1' || digits;
  ELSIF country = 'US' AND digits ~ '^1[2-9][0-9]{9}$' THEN RETURN '+' || digits;
  END IF;
  RETURN NULL;
END $$;

UPDATE public.leads l SET phone_meta = coalesce((
  SELECT jsonb_object_agg(k, jsonb_build_object('kind','unknown','source','manual','source_url',NULL,'found_at',NULL,'original',p))
  FROM (SELECT DISTINCT ON (public.phone_metadata_key(p, l.country)) p, public.phone_metadata_key(p, l.country) k
    FROM unnest(ARRAY[l.phone] || l.additional_phones) p
    WHERE public.phone_metadata_key(p, l.country) IS NOT NULL) old_phones
), '{}'::jsonb);

-- Keep provenance honest when an older writer edits a contact phone without supplying new metadata.
-- The existing provider-owned-column guard remains in force, as do the existing row policies.
CREATE FUNCTION public.contact_phone_metadata_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND ROW(NEW.phone_kind, NEW.phone_source, NEW.phone_source_url, NEW.phone_found_at)
    IS NOT DISTINCT FROM ROW(OLD.phone_kind, OLD.phone_source, OLD.phone_source_url, OLD.phone_found_at) THEN
    NEW.phone_kind := 'unknown'; NEW.phone_source := 'manual'; NEW.phone_source_url := NULL;
    NEW.phone_found_at := CASE WHEN nullif(btrim(NEW.phone), '') IS NULL THEN NULL ELSE now() END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contact_phone_metadata_changed BEFORE UPDATE OF phone ON public.decision_maker_candidates
  FOR EACH ROW EXECUTE FUNCTION public.contact_phone_metadata_changed();

-- Older browser/worker writers still get explicit unknown/manual metadata. Explicit evidence supplied in the
-- same write wins. Removed numbers may retain history, but filters only examine numbers still on the lead.
CREATE FUNCTION public.lead_phone_metadata_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE p text; k text;
BEGIN
  FOR p IN SELECT unnest(ARRAY[NEW.phone] || NEW.additional_phones) LOOP
    k := public.phone_metadata_key(p, NEW.country);
    IF k IS NOT NULL AND NOT (NEW.phone_meta ? k) THEN
      NEW.phone_meta := NEW.phone_meta || jsonb_build_object(k, jsonb_build_object(
        'kind','unknown','source','manual','source_url',NULL,'found_at',now(),'original',p));
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER lead_phone_metadata_changed BEFORE INSERT OR UPDATE OF phone, additional_phones, phone_meta ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_phone_metadata_changed();

-- Metadata is evidence, never authority to call, reveal, send or enrol. No RLS/grant/guard changes beyond
-- the four new contact-column grants above. No new table, cron, provider, feature switch or remote action.
