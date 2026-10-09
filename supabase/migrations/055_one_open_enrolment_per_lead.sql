-- 055: a lead can have only one open (active or paused) sequence enrolment at a time.
-- Live data was checked: 0 duplicates. Code paths that insert enrolments treat a unique violation (23505) as
-- "already enrolled" and also work while this index is absent, so it can be applied before or after the code.
CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_one_open_per_lead
  ON sequence_enrollments (lead_id) WHERE status IN ('active', 'paused');
