-- decision_maker_candidates.applied_at is never written by any edge function
-- and cannot be written from the client (no UPDATE policy exists on this
-- table, by design). The "Added" state for a Hunter contact lives only in
-- DecisionMakerReview.tsx's ephemeral React state — dropping this dead
-- column rather than adding a new client-writable path to this table.

ALTER TABLE decision_maker_candidates DROP COLUMN applied_at;
