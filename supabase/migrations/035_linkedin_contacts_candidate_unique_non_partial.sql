-- linkedin_contacts_candidate_unique (migration 034) was a PARTIAL unique
-- index (WHERE decision_maker_candidate_id IS NOT NULL). PostgREST's
-- onConflict option only ever generates ON CONFLICT (columns), which
-- cannot target a partial index without repeating its exact predicate --
-- Postgres rejects this with 42P10, silently breaking find-decision-makers'
-- linkedin_contacts upsert. The partial predicate was unnecessary anyway: a
-- plain unique index on a nullable column already permits unlimited NULLs
-- under standard SQL semantics, so this changes nothing about real
-- behavior while fixing the upsert.
DROP INDEX linkedin_contacts_candidate_unique;
CREATE UNIQUE INDEX linkedin_contacts_candidate_unique ON linkedin_contacts (decision_maker_candidate_id);
