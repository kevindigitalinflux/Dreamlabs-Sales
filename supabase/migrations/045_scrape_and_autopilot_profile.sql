-- Carry an ideal customer profile (migration 044) from a lead search to the leads it finds,
-- so leads arrive already tagged with who they are and email drafting/AI context just works.
--
--   scrape_jobs.icp_id      set when a search is run "for" a profile; approved leads inherit it
--   autopilot_runs.icp_id   same, for an autopilot campaign (passed on to every scrape it triggers
--                           and set on every lead it auto-approves)
--
-- ON DELETE SET NULL: deleting a profile just un-tags future approvals; leads keep their own
-- icp_id handling (also SET NULL). No policy or grant changes: both tables already
-- scope access by org, and the edge functions validate that a supplied profile belongs to
-- the same org before storing it.

ALTER TABLE scrape_jobs    ADD COLUMN icp_id UUID REFERENCES ideal_customer_profiles(id) ON DELETE SET NULL;
ALTER TABLE autopilot_runs ADD COLUMN icp_id UUID REFERENCES ideal_customer_profiles(id) ON DELETE SET NULL;
