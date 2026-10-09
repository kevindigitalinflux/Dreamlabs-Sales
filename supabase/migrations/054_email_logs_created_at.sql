-- 054: when an email_logs row was created. `sent_at` is overwritten when a draft is released, so it cannot say
-- when a sequence draft was made; check-sequences needs that to tell THIS step's draft (released or not) from
-- an earlier step's. Apply BEFORE deploying the new check-sequences (it selects this column and fails closed,
-- skipping enrolments, without it). Short on purpose: email_logs is written constantly.
--
-- Backfill rule (final review): rows already released (status <> 'draft') that belong to an enrolment have an
-- unknown creation time (sent_at is the RELEASE time), so they get the epoch and can never be mistaken for
-- "this step's draft". Worst case is one extra draft that a person sees in review, never a silently skipped step.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE email_logs
   SET created_at = CASE
         WHEN sequence_enrollment_id IS NOT NULL AND status <> 'draft' THEN '1970-01-01T00:00:00Z'::timestamptz
         ELSE COALESCE(sent_at, now())
       END
 WHERE created_at IS NULL;
ALTER TABLE email_logs ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
