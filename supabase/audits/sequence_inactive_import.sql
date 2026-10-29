-- DISPOSABLE / ROLLED-BACK DRY RUN ONLY. Applies no persistent schema or data changes.
-- Claude may run this entire block after review, before applying migration 071.
DO $$
DECLARE was_present boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'email_sequences' AND column_name = 'is_active') INTO was_present;
  IF was_present THEN RAISE EXCEPTION 'Run against a disposable pre-071 database; column already exists'; END IF;
  ALTER TABLE public.email_sequences ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  IF EXISTS (SELECT 1 FROM public.email_sequences WHERE is_active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'FAIL: historical sequence activation changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'email_sequences' AND column_name = 'is_active' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION 'FAIL: missing non-null activation flag';
  END IF;
  RAISE EXCEPTION 'PASS: additive default verified; entire dry run rolled back';
END $$;
