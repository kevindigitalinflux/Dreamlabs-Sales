-- 054: when an email_logs row was created. `sent_at` is overwritten when a draft is released, so it cannot say
-- when a sequence draft was made; check-sequences needs that to tell THIS step's draft (released or not) from
-- an earlier step's. Apply BEFORE deploying the new check-sequences (it selects this column and fails closed,
-- skipping enrolments, without it). Short on purpose: email_logs is written constantly.
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE email_logs SET created_at = COALESCE(sent_at, now()) WHERE created_at IS NULL;
ALTER TABLE email_logs ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
