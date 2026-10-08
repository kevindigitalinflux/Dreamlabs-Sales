-- 053: contacts found automatically by a provider (Hunter, Apollo, Companies House, CRO) must not
-- receive sequence follow-ups unless the user switches 'Include in sequences' on.
--
-- Product ruling: a person a search found was never emailed in step 1, so they must not suddenly
-- get step 2. Rows typed by the user or confirmed in Dream Agent keep inserting
-- include_in_sequences = true explicitly from the client (newContactRow); server-side provider
-- inserts omit the column and rely on the new default. A manual person added through a future
-- server-side flow (known-person lookup) must send true explicitly.
--
-- Apply BEFORE deploying the new check-sequences. Idempotent.
ALTER TABLE decision_maker_candidates ALTER COLUMN include_in_sequences SET DEFAULT false;

UPDATE decision_maker_candidates
SET include_in_sequences = false
WHERE source IN ('hunter', 'apollo', 'companies_house', 'cro')
  AND include_in_sequences IS DISTINCT FROM false;
